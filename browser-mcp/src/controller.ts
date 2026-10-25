import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { config } from '../config.js';
import type { ToolResult } from '../types.js';

/**
 * Low-level browser controller built on Playwright Chromium.
 * Gives the DeepSeek agent the ability to view web pages, watch videos and
 * play web games by driving a real browser (screenshots + input simulation).
 */
export class BrowserController {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private lastNavigation = '';

  async ensureLaunched(): Promise<void> {
    if (this.browser) return;
    this.browser = await chromium.launch({
      headless: process.env.BROWSER_HEADLESS !== 'false',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required'],
    });
    this.context = await this.browser.newContext({
      viewport: { width: config.browser.width, height: config.browser.height },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    });
    this.page = await this.context.newPage();
    this.page.on('console', () => {});
  }

  private get page_(): Page {
    if (!this.page) throw new Error('browser not launched');
    return this.page;
  }

  async navigate(url: string): Promise<ToolResult> {
    await this.ensureLaunched();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    await this.page_!.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page_!.waitForTimeout(1200);
    this.lastNavigation = url;
    const obs = await this.getObservation();
    return { text: `Navigated to ${url}\n${obs.text}` };
  }

  async screenshot(): Promise<ToolResult> {
    await this.ensureLaunched();
    const buf = await this.page_!.screenshot({ type: 'png', fullPage: false });
    return { image: buf, mime: 'image/png', text: 'Current page screenshot.' };
  }

  /** Observation: title, url and a compact text/accessibility summary. */
  async getObservation(): Promise<ToolResult> {
    await this.ensureLaunched();
    const info = await this.page_!.evaluate(() => {
      const title = document.title;
      const url = location.href;
      const text = (document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 1500);
      const inputs = Array.from(document.querySelectorAll('input,textarea,button,a,select'))
        .slice(0, 40)
        .map((el) => {
          const tag = el.tagName.toLowerCase();
          const name =
            (el as HTMLElement).getAttribute('aria-label') ||
            (el as HTMLElement).getAttribute('placeholder') ||
            (el as HTMLElement).getAttribute('name') ||
            (el as HTMLElement).textContent?.trim().slice(0, 30) ||
            '';
          return `${tag}:${name}`;
        });
      return { title, url, text, inputs };
    });
    return {
      text:
        `URL: ${info.url}\nTITLE: ${info.title}\n` +
        `VISIBLE TEXT:\n${info.text}\n` +
        `KEY ELEMENTS:\n${info.inputs.join('\n')}`,
    };
  }

  async click(selector: string): Promise<ToolResult> {
    await this.ensureLaunched();
    try {
      await this.page_!.click(selector, { timeout: 5000 });
    } catch {
      // Fallback: treat selector as "x,y" coordinates.
      const [x, y] = selector.split(',').map((n) => Number(n.trim()));
      if (Number.isFinite(x) && Number.isFinite(y)) {
        await this.page_!.mouse.click(x, y);
      } else {
        return { text: `Could not click "${selector}" (no matching element).` };
      }
    }
    await this.page_!.waitForTimeout(600);
    return { text: `Clicked "${selector}".` };
  }

  async type(selector: string, text: string): Promise<ToolResult> {
    await this.ensureLaunched();
    await this.page_!.fill(selector, text).catch(async () => {
      await this.page_!.keyboard.type(text);
    });
    await this.page_!.waitForTimeout(300);
    return { text: `Typed "${text}" into "${selector}".` };
  }

  async pressKey(key: string): Promise<ToolResult> {
    await this.ensureLaunched();
    await this.page_!.keyboard.press(key);
    await this.page_!.waitForTimeout(200);
    return { text: `Pressed key "${key}".` };
  }

  async scroll(dx: number, dy: number): Promise<ToolResult> {
    await this.ensureLaunched();
    await this.page_!.mouse.wheel(dx, dy);
    await this.page_!.waitForTimeout(300);
    return { text: `Scrolled by (${dx}, ${dy}).` };
  }

  async mouse(action: 'move' | 'down' | 'up' | 'click', x: number, y: number): Promise<ToolResult> {
    await this.ensureLaunched();
    const p = this.page_!;
    if (action === 'move') await p.mouse.move(x, y);
    else if (action === 'down') await p.mouse.down();
    else if (action === 'up') await p.mouse.up();
    else await p.mouse.click(x, y);
    await p.waitForTimeout(150);
    return { text: `Mouse ${action} at (${x}, ${y}).` };
  }

  /** Inspect <video> elements: is anything playing? currentTime / duration. */
  async videoStatus(): Promise<ToolResult> {
    await this.ensureLaunched();
    const v = await this.page_!.evaluate(() => {
      const videos = Array.from(document.querySelectorAll('video'));
      return videos.map((vid) => ({
        paused: vid.paused,
        currentTime: Math.floor(vid.currentTime),
        duration: Math.floor(vid.duration || 0),
        muted: vid.muted,
        readyState: vid.readyState,
        w: vid.videoWidth,
        h: vid.videoHeight,
      }));
    });
    if (!v.length) return { text: 'No <video> element found on the current page.' };
    return { text: 'Video status:\n' + v.map((x) => JSON.stringify(x)).join('\n') };
  }

  /** Run arbitrary read-only JS in page context (for game state inspection). */
  async evaluate(js: string): Promise<ToolResult> {
    await this.ensureLaunched();
    try {
      const r = await this.page_!.evaluate((code) => {
        // eslint-disable-next-line no-new-func
        const fn = new Function('return (' + code + ')');
        return fn();
      }, js);
      return { text: 'Eval result: ' + JSON.stringify(r).slice(0, 2000) };
    } catch (e) {
      return { text: 'Eval error: ' + (e as Error).message };
    }
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => {});
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  get currentUrl(): string {
    return this.lastNavigation;
  }
}
