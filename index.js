/**
 * DSH in-process plugin: real browser + server-control tools for the DeepSeek agent.
 *
 * Ported from xiao384/DSH_CJ (plugin/src/index.ts) and adapted to the DSH
 * 0.2.1 tool contract:
 *  - parameters use the unified DSH schema DSL (not JSON Schema);
 *  - output.schema declares the canonical value, render() builds content blocks;
 *  - screenshots are stored through the attachments service and rendered as an
 *    image content block, with a text-only fallback when no store is mounted.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { BrowserController } from './lib/browser.js'
import { browserTools } from './lib/tools.js'
import { systemTools, serverControlEnabled, disposeTerminal } from './lib/system.js'

export const name = 'dsh-qq-browser-bridge'
// Only depend on the tool registry. Everything else (attachments) is optional
// and resolved lazily so a different composition never blocks registration.
export const inject = ['tools']

/** Durable image metadata an ImageBlock carries (same shape as read_image). */
const IMAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    attachmentId: { type: 'string', required: true },
    mediaType: { type: 'string', required: true },
    bytes: { type: 'integer', required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
    name: { type: 'string' },
  },
}

export function apply(ctx) {
  const controller = new BrowserController()

  ctx.effect(() => () => {
    void controller.close()
    disposeTerminal()
  })

  for (const tool of [...browserTools, ...systemTools]) {
    const imageTool = tool.image === true
    ctx.tools.register(
      defineTool({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        output: imageTool
          ? {
              schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  text: { type: 'string', required: true },
                  image: IMAGE_SCHEMA,
                },
              },
              render: (_args, value) => {
                const blocks = [{ type: 'text', text: value.text }]
                if (value.image) blocks.push({ type: 'image', attachment: value.image })
                return blocks
              },
            }
          : {
              schema: { type: 'string' },
              render: (_args, value) => [{ type: 'text', text: value }],
            },
        async execute(args, exec) {
          const result = await tool.run(args ?? {}, { controller, exec })
          if (!imageTool) return result?.text ?? ''
          if (!result?.image) return { text: result?.text ?? '(no output)' }
          const attachments = ctx.get('attachments')
          if (!attachments?.saveImage) {
            return { text: `${result.text ?? 'Screenshot'}\n(screenshot not attached: no attachment service is mounted)` }
          }
          const ref = await attachments.saveImage({
            data: result.image,
            mediaType: result.mime ?? 'image/png',
            name: 'browser-screenshot.png',
          })
          return {
            text: result.text ?? 'Screenshot',
            image: {
              attachmentId: ref.attachmentId,
              mediaType: ref.mediaType,
              bytes: ref.bytes,
              width: ref.width,
              height: ref.height,
              ...(ref.name === undefined ? {} : { name: ref.name }),
            },
          }
        },
      }),
    )
  }

  if (serverControlEnabled) {
    console.warn(
      '[dsh-browser-tools] ⚠️ SERVER CONTROL ENABLED: server_exec / file tools grant shell & file ' +
        'access to whoever can prompt the agent. Restrict the QQ bridge to the owner / a trusted ' +
        'whitelist, or set SERVER_CONTROL_ENABLED=0 to disable.',
    )
  }
  console.log(
    `[dsh-browser-tools] registered ${browserTools.length} browser tools + ${systemTools.length} server-control tools`,
  )
}
