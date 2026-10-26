/**
 * Low-level browser controller built on Playwright.
 *
 * Gives the DeepSeek agent the ability to view web pages, watch videos and
 * play web games by driving a real Chromium browser (screenshots + input).
 *
 * Ported from DSH_CJ src/browser/controller.ts. Defaults to the local
 * Microsoft Edge channel so no Playwright browser download is required:
 *   BROWSER_CHANNEL=msedge|chrome|<empty>   (empty = Playwright's bundled Chromium)
 *   BROWSER_EXECUTABLE=<path to chrome.exe>
 *   BROWSER_HEADLESS=false                  (show the window)
 */
import { chromium } from 'playwright-core'

const VIEWPORT = {
  width: Number(process.env.BROWSER_WIDTH || 1280),
  height: Number(process.env.BROWSER_HEIGHT || 800),
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

export class BrowserController {
  constructor() {
    this.browser = null
    this.context = null
    this.page = null
    this.lastNavigation = ''
  }

  async ensureLaunched() {
    if (this.browser) return
    const headless = process.env.BROWSER_HEADLESS !== 'false'
    const executablePath = process.env.BROWSER_EXECUTABLE || undefined
    const preferredChannel = process.env.BROWSER_CHANNEL ?? 'msedge'
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-blink-features=AutomationControlled',
    ]

    const attempts = []
    if (executablePath) attempts.push({ headless, args, executablePath })
    else {
      if (preferredChannel) attempts.push({ headless, args, channel: preferredChannel })
      attempts.push({ headless, args })
    }

    let lastError = null
    for (const options of attempts) {
      try {
        this.browser = await chromium.launch(options)
        lastError = null
        break
      } catch (error) {
        lastError = error
      }
    }
    if (!this.browser) {
      throw new Error(
        `browser launch failed: ${lastError?.message ?? 'unknown error'}. ` +
          'Install Edge/Chrome and set BROWSER_CHANNEL, or run "npx playwright install chromium".',
      )
    }

    this.context = await this.browser.newContext({
      viewport: VIEWPORT,
      userAgent: USER_AGENT,
    })
    this.page = await this.context.newPage()
    this.page.setDefaultTimeout(15000)
  }

  get current() {
    if (!this.page) throw new Error('browser not launched')
    return this.page
  }

  async navigate(url) {
    await this.ensureLaunched()
    let target = String(url || '').trim()
    if (!/^https?:\/\//i.test(target)) target = 'https://' + target
    await this.current.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await this.current.waitForTimeout(1200)
    this.lastNavigation = target
    const observation = await this.getObservation()
    return { text: `Navigated to ${target}\n${observation.text}` }
  }

  async screenshot() {
    await this.ensureLaunched()
    const image = await this.current.screenshot({ type: 'png', fullPage: false })
    return { image, mime: 'image/png', text: 'Current page screenshot.' }
  }

  /** Observation: title, url and a compact text/accessibility summary. */
  async getObservation() {
    await this.ensureLaunched()
    const info = await this.current.evaluate(() => {
      const title = document.title
      const url = location.href
      const text = (document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 1500)
      const inputs = Array.from(document.querySelectorAll('input,textarea,button,a,select'))
        .slice(0, 40)
        .map((el) => {
          const tag = el.tagName.toLowerCase()
          const name =
            el.getAttribute('aria-label') ||
            el.getAttribute('placeholder') ||
            el.getAttribute('name') ||
            el.textContent?.trim().slice(0, 30) ||
            ''
          return `${tag}:${name}`
        })
      return { title, url, text, inputs }
    })
    return {
      text:
        `URL: ${info.url}\nTITLE: ${info.title}\n` +
        `VISIBLE TEXT:\n${info.text}\n` +
        `KEY ELEMENTS:\n${info.inputs.join('\n')}`,
    }
  }

  async click(selector) {
    await this.ensureLaunched()
    try {
      await this.current.click(selector, { timeout: 5000 })
    } catch {
      // Fallback: treat selector as "x,y" pixel coordinates.
      const [x, y] = String(selector)
        .split(',')
        .map((n) => Number(n.trim()))
      if (Number.isFinite(x) && Number.isFinite(y)) {
        await this.current.mouse.click(x, y)
      } else {
        return { text: `Could not click "${selector}" (no matching element).` }
      }
    }
    await this.current.waitForTimeout(600)
    return { text: `Clicked "${selector}".` }
  }

  async type(selector, text) {
    await this.ensureLaunched()
    await this.current.fill(selector, text).catch(async () => {
      await this.current.keyboard.type(text)
    })
    await this.current.waitForTimeout(300)
    return { text: `Typed "${text}" into "${selector}".` }
  }

  async pressKey(key) {
    await this.ensureLaunched()
    await this.current.keyboard.press(key)
    await this.current.waitForTimeout(200)
    return { text: `Pressed key "${key}".` }
  }

  async scroll(dx, dy) {
    await this.ensureLaunched()
    await this.current.mouse.wheel(dx, dy)
    await this.current.waitForTimeout(300)
    return { text: `Scrolled by (${dx}, ${dy}).` }
  }

  async mouse(action, x, y) {
    await this.ensureLaunched()
    const page = this.current
    if (action === 'move') await page.mouse.move(x, y)
    else if (action === 'down') await page.mouse.down()
    else if (action === 'up') await page.mouse.up()
    else await page.mouse.click(x, y)
    await page.waitForTimeout(150)
    return { text: `Mouse ${action} at (${x}, ${y}).` }
  }

  /**
   * Inspect <video> elements and (by default) capture the CURRENT FRAME as an
   * image so a vision model can actually SEE what is playing. Call repeatedly
   * to follow the video. Set captureFrame:false for status-only.
   */
  async video({ captureFrame = true, selector = '', index = 0 } = {}) {
    await this.ensureLaunched()
    const status = await this.current.evaluate(() => {
      const list = Array.from(document.querySelectorAll('video'))
      if (!list.length) return { found: false, videos: [] }
      const videos = list.map((v) => ({
        paused: v.paused,
        currentTime: Math.floor(v.currentTime),
        duration: Math.floor(v.duration || 0),
        muted: v.muted,
        readyState: v.readyState,
        w: v.videoWidth,
        h: v.videoHeight,
      }))
      return { found: true, videos }
    })
    if (!status.found) return { text: 'No <video> element found on the current page.' }
    const text = 'Video status:\n' + status.videos.map((v) => JSON.stringify(v)).join('\n')
    if (!captureFrame) return { text }
    try {
      const locator = selector
        ? this.current.locator(selector)
        : this.current.locator('video').nth(index)
      const image = await locator.screenshot({ type: 'png' })
      return { text, image, mime: 'image/png' }
    } catch (err) {
      return { text: text + `\n(frame capture failed: ${err?.message ?? err})` }
    }
  }

  /** Run a read-only JS expression in page context (for game state inspection). */
  async evaluate(js) {
    await this.ensureLaunched()
    try {
      const result = await this.current.evaluate((code) => {
        // eslint-disable-next-line no-new-func
        const fn = new Function('return (' + code + ')')
        return fn()
      }, js)
      return { text: 'Eval result: ' + JSON.stringify(result).slice(0, 2000) }
    } catch (error) {
      return { text: 'Eval error: ' + (error?.message ?? String(error)) }
    }
  }

  async close() {
    try {
      await this.browser?.close()
    } catch {
      /* ignore */
    }
    this.browser = null
    this.context = null
    this.page = null
  }
}
