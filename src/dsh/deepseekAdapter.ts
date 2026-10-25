import { config } from '../config.js';
import type { AgentBackend, AgentReply, AgentRequest, Thinker } from './backend.js';
import { BrowserController } from '../browser/controller.js';
import { browserTools, type ToolContext } from '../browser/tools.js';
import type { BridgeMode } from '../config.js';

const SYSTEM_PROMPT = `你是接入 QQ 的 DeepSeek 智能助手，挂载了真实浏览器控制能力。
你可以通过浏览器工具：打开网页、截图、点击、输入文字、按键盘、滚动、查看视频播放状态、运行网页游戏。
当被要求"看网页 / 看视频 / 玩网页游戏"时，主动使用浏览器工具，并把你看到的内容（截图与文字）描述给用户。
回复要自然、简洁、口语化，像在 QQ 上聊天。中文回复。`;

type Content = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Content[];
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
}

/**
 * Standalone DeepSeek backend. Runs the full agent loop with browser tools
 * directly against the DeepSeek Chat Completions API (function calling).
 * Fully runnable with just DEEPSEEK_API_KEY.
 */
export class DeepSeekBackend implements AgentBackend, Thinker {
  readonly mode: BridgeMode = 'deepseek';
  private readonly controller = new BrowserController();
  private readonly history = new Map<string, ChatMessage[]>();
  private readonly toolCtx: ToolContext = { controller: this.controller, thinker: this };

  private modelMessages(chatId: string): ChatMessage[] {
    if (!this.history.has(chatId)) {
      this.history.set(chatId, [{ role: 'system', content: SYSTEM_PROMPT }]);
    }
    return this.history.get(chatId)!;
  }

  async reply(req: AgentRequest): Promise<AgentReply> {
    const msgs = this.modelMessages(req.chatId);
    const userContent: Content[] = [{ type: 'text', text: req.text }];
    for (const img of req.images ?? []) {
      userContent.push({ type: 'image_url', image_url: { url: img } });
    }
    msgs.push({ role: 'user', content: userContent });

    const collectedImages: AgentReply['images'] = [];
    const tools = browserTools.map((t) => ({ type: 'function', function: t.def }));

    for (let i = 0; i < 8; i++) {
      const resp = await this.callChat(msgs, tools);
      const msg = resp.choices?.[0]?.message;
      if (!msg) break;
      msgs.push(msg as ChatMessage);

      if (msg.tool_calls && msg.tool_calls.length) {
        for (const tc of msg.tool_calls) {
          const tool = browserTools.find((t) => t.def.name === tc.function.name);
          let resultText = 'tool not found';
          let image: Buffer | undefined;
          let mime: string | undefined;
          if (tool) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(tc.function.arguments || '{}');
            } catch {
              args = {};
            }
            const r = await tool.run(args, this.toolCtx);
            resultText = r.text ?? '';
            image = r.image;
            mime = r.mime;
          }
          if (image) collectedImages.push({ data: image, mime: mime ?? 'image/png' });
          msgs.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.function.name,
            content: resultText,
          });
        }
        continue; // let the model act on tool results
      }

      // Final answer.
      const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      this.trimHistory(req.chatId);
      return { text, images: collectedImages.length ? collectedImages : undefined };
    }
    return { text: '（处理超时，请重试）' };
  }

  /** Simple completion used by the browser planner. */
  async think(system: string, user: string): Promise<string> {
    const r = await this.callChat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      undefined,
    );
    return r.choices?.[0]?.message?.content?.toString() ?? '';
  }

  reset(chatId: string): void {
    this.history.delete(chatId);
  }

  async browserReset(): Promise<void> {
    await this.controller.close();
  }

  private trimHistory(chatId: string): void {
    const msgs = this.history.get(chatId)!;
    if (msgs.length > 24) this.history.set(chatId, [msgs[0], ...msgs.slice(-22)]);
  }

  private async callChat(
    messages: ChatMessage[],
    tools?: unknown,
  ): Promise<any> {
    const body: Record<string, unknown> = {
      model: config.deepseek.model,
      messages,
      temperature: 0.7,
    };
    if (tools) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }
    const res = await fetch(`${config.deepseek.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.deepseek.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`DeepSeek API error ${res.status}: ${txt.slice(0, 300)}`);
    }
    return res.json();
  }
}
