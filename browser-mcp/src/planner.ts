import type { BrowserController } from './controller.js';
import type { ToolResult } from '../types.js';
import { config } from '../config.js';

/** Provides the reasoning capability for the high-level planner. */
export interface Thinker {
  think(system: string, user: string): Promise<string>;
}

const SYSTEM = `You are a web-operation planner controlling a real browser for a DeepSeek agent.
Given the user's GOAL and the current PAGE OBSERVATION, decide the single next action.
Respond with ONLY a JSON object, one of:
  {"action":"navigate","url":"https://..."}
  {"action":"click","target":"<css selector or x,y coords>"}
  {"action":"type","target":"<selector>","text":"<text to type>"}
  {"action":"key","key":"<Enter|Space|ArrowLeft|...>"}
  {"action":"scroll","dx":0,"dy":400}
  {"action":"screenshot"}
  {"action":"video"}            // check if a video is playing
  {"action":"observe"}          // re-read page text
  {"action":"finish","answer":"<what you saw / did>"}
Do not explain. If the goal is achieved or impossible, use "finish".`;

interface Plan {
  action: string;
  url?: string;
  target?: string;
  text?: string;
  key?: string;
  dx?: number;
  dy?: number;
  answer?: string;
}

function parsePlan(raw: string): Plan | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as Plan;
  } catch {
    return null;
  }
}

/**
 * Run an autonomous browser task: observe -> think -> act, until "finish"
 * or max steps. Returns the collected observations/screenshots.
 */
export async function runBrowserTask(
  goal: string,
  controller: BrowserController,
  thinker: Thinker,
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  let observation = (await controller.getObservation()).text ?? '';
  for (let step = 0; step < config.browser.maxSteps; step++) {
    const user = `GOAL: ${goal}\n\nPAGE OBSERVATION:\n${observation}\n\nDecide the next action.`;
    const raw = await thinker.think(SYSTEM, user);
    const plan = parsePlan(raw);
    if (!plan || plan.action === 'finish') {
      if (plan?.answer) results.push({ text: `Task finished: ${plan.answer}` });
      else results.push({ text: 'Task finished (no answer provided).' });
      break;
    }
    let res: ToolResult;
    switch (plan.action) {
      case 'navigate':
        res = await controller.navigate(plan.url ?? '');
        break;
      case 'click':
        res = await controller.click(plan.target ?? '');
        break;
      case 'type':
        res = await controller.type(plan.target ?? 'body', plan.text ?? '');
        break;
      case 'key':
        res = await controller.pressKey(plan.key ?? 'Enter');
        break;
      case 'scroll':
        res = await controller.scroll(plan.dx ?? 0, plan.dy ?? 0);
        break;
      case 'screenshot':
        res = await controller.screenshot();
        break;
      case 'video':
        res = await controller.videoStatus();
        break;
      case 'observe':
        res = await controller.getObservation();
        break;
      default:
        res = { text: `Unknown action "${plan.action}", skipping.` };
    }
    results.push(res);
    if (plan.action === 'screenshot') {
      // already captured as image; refresh text observation too
    }
    observation = (await controller.getObservation()).text ?? observation;
    if (step === config.browser.maxSteps - 1) {
      results.push({ text: 'Reached max steps; stopping.' });
    }
  }
  return results;
}
