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
      'Read the current page: title, URL, visible text, key elements AND a list of all FRAMES/iframes. ' +
      'Raise limit to see more text (default 1500, max 20000). Use browser_frame to work inside an iframe. ' +
      'To see the WHOLE page visually, use browser_screenshot with fullPage:true.',
    parameters: {
      limit: { type: 'integer', description: 'Max visible-text chars (default 1500, max 20000)' },
      maxElements: { type: 'integer', description: 'Max key elements to list (default 40, max 200)' },
    },
    run: (args, { controller }) =>
      controller.getObservation({ limit: num(args.limit, 1500), maxElements: num(args.maxElements, 40) }),
  },
  {
    name: 'browser_screenshot',
    description:
      'Take a PNG screenshot. Default is the current VIEWPORT only. Set fullPage:true to capture the ' +
      'ENTIRE scrollable page (use this when you cannot see the whole page). Or pass selector to ' +
      'capture one element. Note: fullPage only scrolls the main document, not inner scroll containers/iframes.',
    parameters: {
      fullPage: { type: 'boolean', description: 'Capture the whole scrollable page (default false)' },
      selector: { type: 'string', description: 'Optional CSS selector to capture just that element' },
    },
    image: true,
    run: (args, { controller }) =>
      controller.screenshot({ fullPage: args.fullPage === true, selector: str(args.selector) }),
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
      'Type text. For normal forms pass target (CSS selector). For WEB TERMINALS (xterm.js canvas, ' +
      'ModelScope /code/workspace, VSCode Web, JupyterLab) there is NO fillable input: first click the ' +
      'terminal (browser_click "x,y" or browser_frame focus), then call browser_type with target ' +
      'omitted / "focus" to type into the CURRENT FOCUS, and set pressEnter:true to run the command.',
    parameters: {
      target: { type: 'string', description: 'CSS selector; omit or "focus" to type into current focus' },
      text: { type: 'string', required: true, description: 'Text / command to type' },
      pressEnter: { type: 'boolean', description: 'Press Enter after typing (default false)' },
      delay: { type: 'integer', description: 'Ms between keystrokes (0-200); 20-50 helps canvas terminals' },
    },
    run: (args, { controller }) =>
      controller.type(str(args.target), str(args.text), {
        pressEnter: args.pressEnter === true,
        delay: num(args.delay, 0),
      }),
  },
  {
    name: 'browser_key',
    description:
      'Send a keyboard key to the page. action="press" (default) taps it; action="down" HOLDS it ' +
      '(e.g. hold ArrowLeft / "w" to walk in a game); action="up" releases a held key. ' +
      'Chords work too: "Control+C", "Shift+ArrowRight" (modifiers pressed/released in order). ' +
      'repeat taps the key N times for action=press. Key names follow Playwright ' +
      '("Enter", "a", "ArrowLeft", "Space", "Shift"). Click the canvas first for keyboard focus.',
    parameters: {
      key: { type: 'string', required: true, description: 'Key name or chord (Playwright syntax)' },
      action: { type: 'string', description: 'press | down | up (default press)' },
      repeat: { type: 'integer', description: 'Times to tap for action=press (default 1, max 20)' },
    },
    run: (args, { controller }) =>
      controller.pressKey(str(args.key), str(args.action, 'press'), num(args.repeat, 1)),
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
      'Move / press / release / click the mouse at pixel coordinates. "down" moves to (x,y) first ' +
      'then holds; "up" releases at the current position (down -> move -> up = drag). ' +
      'button:"right" opens context menus; clickCount:2 double-clicks. For web pages and games.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        description: 'One of: move, down, up, click',
      },
      x: { type: 'number', required: true, description: 'Pixel x' },
      y: { type: 'number', required: true, description: 'Pixel y' },
      button: { type: 'string', description: 'left | right | middle (default left)' },
      clickCount: { type: 'integer', description: '2 = double-click, 3 = triple (default 1)' },
    },
    run: (args, { controller }) => {
      const action = str(args.action, 'click')
      if (!['move', 'down', 'up', 'click'].includes(action)) {
        return { text: `Unknown mouse action "${action}" (use move|down|up|click).` }
      }
      return controller.mouse(
        action,
        num(args.x),
        num(args.y),
        str(args.button, 'left'),
        num(args.clickCount, 1),
      )
    },
  },
  {
    name: 'browser_drag',
    description:
      'Drag the mouse: press at (fromX,fromY), glide smoothly to (toX,toY) in `steps`, then release. ' +
      'For drag-based web games (slingshot, steering, drawing). Coordinates are viewport pixels.',
    parameters: {
      fromX: { type: 'number', required: true, description: 'Start x (pixels)' },
      fromY: { type: 'number', required: true, description: 'Start y (pixels)' },
      toX: { type: 'number', required: true, description: 'End x (pixels)' },
      toY: { type: 'number', required: true, description: 'End y (pixels)' },
      steps: { type: 'number', description: 'Smoothness of the glide (default 10)' },
    },
    run: (args, { controller }) =>
      controller.drag(num(args.fromX), num(args.fromY), num(args.toX), num(args.toY), num(args.steps, 10)),
  },
  {
    name: 'browser_video',
    description:
      'Watch the current video: returns playback status (playing/paused, currentTime/duration, muted) ' +
      'AND screenshots of the current video frame(s) so you can actually SEE what is playing. ' +
      'frames>1 grabs several shots spaced by interval ms (one call = continuous watch). ' +
      'captureFrame:false for status only.',
    parameters: {
      captureFrame: { type: 'boolean', description: 'Also capture the video frame(s) as image(s) (default true)' },
      selector: { type: 'string', description: 'Optional CSS selector of the <video> to capture' },
      index: { type: 'integer', description: 'Which <video> when several exist (default 0)' },
      frames: { type: 'integer', description: 'How many frames to grab (default 1, max 8)' },
      interval: { type: 'integer', description: 'Ms between frames when frames>1 (default 1000)' },
    },
    image: true,
    run: (args, { controller }) =>
      controller.video({
        captureFrame: args.captureFrame !== false,
        selector: str(args.selector),
        index: num(args.index),
        frames: num(args.frames, 1),
        interval: num(args.interval, 1000),
      }),
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
  {
    name: 'browser_frame',
    description:
      'Work INSIDE an iframe. Cloud IDEs (ModelScope /code/workspace, VSCode Web, JupyterLab) put the ' +
      'TERMINAL in an iframe, which browser_click / browser_observe / browser_eval CANNOT reach. ' +
      'First call browser_observe to see the FRAMES list, then use frame:"<index>" here.\n' +
      'action "list": show frames. "text": read iframe text incl. xterm.js canvas terminal output. ' +
      '"click"/"focus": target is a CSS selector (e.g. "textarea.xterm-helper-textarea") or "x,y" ' +
      'viewport coords. "type": type into the frame\'s focused element (pressEnter to run a command). ' +
      '"key": press a key. "eval": JS in that frame. "scroll": scroll the frame. "screenshot": image of the iframe.',
    parameters: {
      frame: { type: 'string', description: 'Frame index like "1", "main", or a URL substring; omit to list' },
      action: { type: 'string', description: 'list|text|click|focus|type|key|eval|scroll|screenshot (default list)' },
      target: { type: 'string', description: 'CSS selector or "x,y" coords for click/focus' },
      text: { type: 'string', description: 'Text/command to type (action=type)' },
      key: { type: 'string', description: 'Key to press (action=key, default Enter)' },
      pressEnter: { type: 'boolean', description: 'Press Enter after typing (action=type)' },
      js: { type: 'string', description: 'JS expression (action=eval)' },
      dy: { type: 'number', description: 'Scroll delta (action=scroll, default 400)' },
      limit: { type: 'integer', description: 'Max text chars (action=text, default 4000)' },
    },
    image: true,
    run: (args, { controller }) =>
      controller.frameAction({
        frame: str(args.frame),
        action: str(args.action, 'list'),
        target: str(args.target),
        text: str(args.text),
        js: str(args.js),
        key: str(args.key),
        pressEnter: args.pressEnter === true,
        dy: num(args.dy, 400),
        limit: num(args.limit, 4000),
      }),
  },
  {
    name: 'browser_macro',
    description:
      'Run a SEQUENCE of keyboard/mouse actions in ONE call (a macro) to operate a web page ' +
      'continuously without a round-trip per step. Returns a per-step log AND screenshots ' +
      '(each "screenshot" step plus a final frame by default) so you see the result immediately.\n' +
      'actions is a JSON array string or a line script (one action per line). Actions: ' +
      'navigate URL | click 640,400 (or "click #btn") | dblclick | rclick (right) | move x,y | ' +
      'down [button] | up [button] | drag x1,y1,x2,y2 [steps] | key ArrowRight [down|up] [repeat] | ' +
      'type text | cmd <shell command> (types + presses Enter, for WEB TERMINALS) | scroll dx,dy | ' +
      'wait ms | screenshot | observe | eval <js> | frame <index> <action> [arg] (act inside an iframe).\n' +
      'Example line script: "navigate http://47.76.80.118/\nclick 640,400\nkey ArrowRight down\nwait 600\nkey ArrowRight up"',
    parameters: {
      actions: {
        type: 'string',
        required: true,
        description: 'JSON array of action objects, or a line script (one action per line)',
      },
      finalScreenshot: { type: 'boolean', description: 'Auto-capture a final screenshot (default true)' },
      stopOnError: { type: 'boolean', description: 'Stop at the first failed step (default false)' },
      stepDelay: { type: 'number', description: 'Extra ms to wait after each step (default 0, max 5000)' },
    },
    image: true,
    run: (args, { controller }) =>
      controller.macro(args.actions, {
        finalScreenshot: args.finalScreenshot !== false,
        stopOnError: args.stopOnError === true,
        stepDelay: num(args.stepDelay, 0),
      }),
  },
]
