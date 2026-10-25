import type { BrowserController } from './controller.js';
import type { Thinker } from './planner.js';
import { runBrowserTask } from './planner.js';
import type { ToolDef, ToolResult } from '../types.js';

export interface ToolContext {
  controller: BrowserController;
  thinker?: Thinker;
}

export interface BrowserTool {
  def: ToolDef;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const num = (v: unknown, d = 0): number => (typeof v === 'number' ? v : Number(v) || d);

export const browserTools: BrowserTool[] = [
  {
    def: {
      name: 'browser_navigate',
      description: 'Open a URL in the controlled browser. Use this first to visit a web page, video, or web game.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'Full or bare URL, e.g. https://www.bilibili.com' } },
        required: ['url'],
      },
    },
    run: async (a, c) => c.controller.navigate(str(a.url)),
  },
  {
    def: {
      name: 'browser_observe',
      description: 'Read the current page: title, URL and visible text + key elements. Call after navigating or acting.',
      parameters: { type: 'object', properties: {} },
    },
    run: async (_a, c) => c.controller.getObservation(),
  },
  {
    def: {
      name: 'browser_screenshot',
      description: 'Take a PNG screenshot of the current page. Returns an image the agent (and QQ user) can see.',
      parameters: { type: 'object', properties: {} },
    },
    run: async (_a, c) => c.controller.screenshot(),
  },
  {
    def: {
      name: 'browser_click',
      description: 'Click an element by CSS selector, or by "x,y" pixel coordinates for canvas/web-game buttons.',
      parameters: {
        type: 'object',
        properties: { target: { type: 'string', description: 'CSS selector or "x,y" coordinates' } },
        required: ['target'],
      },
    },
    run: async (a, c) => c.controller.click(str(a.target)),
  },
  {
    def: {
      name: 'browser_type',
      description: 'Type text into an input field (CSS selector). Use for search boxes, chat inputs, login forms.',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'CSS selector of the input' },
          text: { type: 'string', description: 'Text to type' },
        },
        required: ['target', 'text'],
      },
    },
    run: async (a, c) => c.controller.type(str(a.target), str(a.text)),
  },
  {
    def: {
      name: 'browser_key',
      description: 'Press a keyboard key. Essential for web games: ArrowLeft/Right/Up/Down, Space, Enter, etc.',
      parameters: {
        type: 'object',
        properties: { key: { type: 'string', description: 'Key name, e.g. Space, ArrowLeft, Enter' } },
        required: ['key'],
      },
    },
    run: async (a, c) => c.controller.pressKey(str(a.key)),
  },
  {
    def: {
      name: 'browser_scroll',
      description: 'Scroll the page by pixel deltas (dx horizontal, dy vertical).',
      parameters: {
        type: 'object',
        properties: { dx: { type: 'number' }, dy: { type: 'number' } },
      },
    },
    run: async (a, c) => c.controller.scroll(num(a.dx), num(a.dy, 400)),
  },
  {
    def: {
      name: 'browser_mouse',
      description: 'Move / press / release / click the mouse at pixel coordinates. For web-game interaction.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['move', 'down', 'up', 'click'] },
          x: { type: 'number' },
          y: { type: 'number' },
        },
        required: ['action', 'x', 'y'],
      },
    },
    run: async (a, c) =>
      c.controller.mouse(str(a.action, 'click') as 'move' | 'down' | 'up' | 'click', num(a.x), num(a.y)),
  },
  {
    def: {
      name: 'browser_video',
      description: 'Inspect <video> elements: is something playing? currentTime / duration. Use to confirm a video is playing.',
      parameters: { type: 'object', properties: {} },
    },
    run: async (_a, c) => c.controller.videoStatus(),
  },
  {
    def: {
      name: 'browser_eval',
      description: 'Run a read-only JS expression in the page and return its JSON value. Useful to inspect web-game state.',
      parameters: { type: 'object', properties: { js: { type: 'string' } }, required: ['js'] },
    },
    run: async (a, c) => c.controller.evaluate(str(a.js)),
  },
  {
    def: {
      name: 'browser_task',
      description: 'Autonomously pursue a high-level goal (e.g. "watch the trending video", "play the snake game for 30s"). The planner observes and acts step by step.',
      parameters: { type: 'object', properties: { goal: { type: 'string' } }, required: ['goal'] },
    },
    run: async (a, c) => {
      if (!c.thinker) return { text: 'No planner LLM configured for autonomous tasks.' };
      const r = await runBrowserTask(str(a.goal), c.controller, c.thinker);
      return { text: r.map((x) => x.text).join('\n') };
    },
  },
];

export function toolDefs(): ToolDef[] {
  return browserTools.map((t) => t.def);
}
