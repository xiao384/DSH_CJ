/** Browser tool catalog: DSH parameter DSL + runners over the BrowserController. */

const str = (v, d = '') => (typeof v === 'string' ? v : d)
const num = (v, d = 0) => (typeof v === 'number' ? v : Number(v) || d)

/**
 * One tool:
 *   name/description  model-facing identity
 *   parameters        DSH unified schema DSL map ({ field: { type, required, description } })
 *   image             true when run() returns { image: Buffer, mime } to attach
 *   run(args, deps)   async () => ({ text?, image?, mime? })
 */
export const browserTools = [
  {
    name: 'browser_navigate',
    description:
      'Open a URL in the controlled browser. Use this first to visit a web page, video, or web game.',
    parameters: {
      url: { type: 'string', required: true, description: 'Full or bare URL, e.g. https://www.bilibili.com' },
    },
    run: (args, { controller }) => controller.navigate(str(args.url)),
  },
  {
    name: 'browser_observe',
    description:
      'Read the current page: title, URL and visible text + key elements. Call after navigating or acting.',
    parameters: {},
    run: (_args, { controller }) => controller.getObservation(),
  },
  {
    name: 'browser_screenshot',
    description:
      'Take a PNG screenshot of the current page and attach it to the conversation so you can see it.',
    parameters: {},
    image: true,
    run: (_args, { controller }) => controller.screenshot(),
  },
  {
    name: 'browser_click',
    description:
      'Click an element by CSS selector, or by "x,y" pixel coordinates for canvas/web-game buttons.',
    parameters: {
      target: { type: 'string', required: true, description: 'CSS selector or "x,y" coordinates' },
    },
    run: (args, { controller }) => controller.click(str(args.target)),
  },
  {
    name: 'browser_type',
    description:
      'Type text into an input field (CSS selector). Use for search boxes, chat inputs, login forms.',
    parameters: {
      target: { type: 'string', required: true, description: 'CSS selector of the input' },
      text: { type: 'string', required: true, description: 'Text to type' },
    },
    run: (args, { controller }) => controller.type(str(args.target), str(args.text)),
  },
  {
    name: 'browser_key',
    description:
      'Press a keyboard key. Essential for web games: ArrowLeft/ArrowRight/ArrowUp/ArrowDown, Space, Enter, etc.',
    parameters: {
      key: { type: 'string', required: true, description: 'Key name, e.g. Space, ArrowLeft, Enter' },
    },
    run: (args, { controller }) => controller.pressKey(str(args.key)),
  },
  {
    name: 'browser_scroll',
    description: 'Scroll the page by pixel deltas (dx horizontal, dy vertical).',
    parameters: {
      dx: { type: 'number', description: 'Horizontal delta (default 0)' },
      dy: { type: 'number', description: 'Vertical delta (default 400)' },
    },
    run: (args, { controller }) => controller.scroll(num(args.dx), num(args.dy, 400)),
  },
  {
    name: 'browser_mouse',
    description:
      'Move / press / release / click the mouse at pixel coordinates. For web-game interaction.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        description: 'One of: move, down, up, click',
      },
      x: { type: 'number', required: true, description: 'Pixel x' },
      y: { type: 'number', required: true, description: 'Pixel y' },
    },
    run: (args, { controller }) => {
      const action = str(args.action, 'click')
      if (!['move', 'down', 'up', 'click'].includes(action)) {
        return { text: `Unknown mouse action "${action}" (use move|down|up|click).` }
      }
      return controller.mouse(action, num(args.x), num(args.y))
    },
  },
  {
    name: 'browser_video',
    description:
      'Inspect <video> elements: is something playing? currentTime / duration. Use to confirm a video is playing.',
    parameters: {},
    run: (_args, { controller }) => controller.videoStatus(),
  },
  {
    name: 'browser_eval',
    description:
      'Run a read-only JS expression in the page and return its JSON value. Useful to inspect web-game state.',
    parameters: {
      js: { type: 'string', required: true, description: 'JS expression, e.g. document.title' },
    },
    run: (args, { controller }) => controller.evaluate(str(args.js)),
  },
]
