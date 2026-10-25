import { defineTool } from '@deepseek-ai/dsh-tools';
import { BrowserController } from '../browser/controller.js';
import { browserTools } from '../browser/tools.js';
import { config } from '../config.js';
import { OneBotClient } from '../onebot/client.js';
import { toDshParameters, renderOutput, type ToolReturn } from './dshToolShim.js';
import { runSessionBridge } from './sessionBridge.js';

export const name = 'dsh-qq-browser-bridge';
// Only depend on `tools`; we reach `ctx.sessions` dynamically so a different
// service name never blocks tool registration.
export const inject = ['tools'];

export function apply(ctx: any): void {
  const controller = new BrowserController();

  // 1) Register every browser tool into DSH so the DeepSeek agent can
  //    view pages, watch videos and play web games. This is the core
  //    differentiator vs qq-bridge (which restricts the web to read-only).
  for (const t of browserTools) {
    ctx.tools.register(
      defineTool({
        name: t.def.name,
        description: t.def.description,
        parameters: toDshParameters(t.def.parameters),
        // The tool's execute() returns an object {text, imageBase64, mime},
        // so the output schema must describe that object (not a bare string).
        output: {
          schema: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              imageBase64: { type: 'string' },
              mime: { type: 'string' },
            },
          },
          render: (_args: unknown, value: ToolReturn) => renderOutput(value),
        },
        async execute(args: Record<string, unknown>): Promise<ToolReturn> {
          const r = await t.run(args, { controller, thinker: undefined });
          return {
            text: r.text ?? '',
            imageBase64: r.image ? r.image.toString('base64') : undefined,
            mime: r.mime,
          };
        },
      }),
    );
  }
  console.log(`[${name}] registered ${browserTools.length} browser tools`);

  // 2) Optionally bridge QQ (OneBot / SnowLuma) into DSH sessions.
  //    Off by default: align the [DSH-ADJUST] seams in sessionBridge.ts first.
  if (process.env.DSH_INPROC_BRIDGE === '1') {
    ctx.effect(() => {
      const ob = new OneBotClient();
      ob.start().catch((e) => console.error('[session-bridge] onebot start failed:', e.message));
      const bridge = runSessionBridge(ctx, ob);
      const handler = (ev: any) => bridge.onMessage(ev).catch(() => {});
      ob.on('message', handler);
      console.log(`[${name}] QQ->DSH session bridge enabled`);
      return () => {
        bridge.dispose();
        ob.removeAllListeners?.();
      };
    });
  }
}
