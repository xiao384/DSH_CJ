import { createHmac } from 'node:crypto';
import { config } from '../config.js';
import type { AgentBackend, AgentReply, AgentRequest } from './backend.js';
import type { BridgeMode } from '../config.js';

/**
 * DSH (DeepSeek Harness) backend. Forwards QQ chats to a running DSH instance
 * over its local Web API and relays the agent's reply (text + images) back.
 *
 * In this mode the browser powers come from the browser MCP server that DSH
 * launches (see BROWSER_MCP_CMD in .env). The bridge is purely transport,
 * exactly like qq-bridge.
 *
 * NOTE: DSH's exact Web API paths/shape are not part of the public docs used
 * here. The endpoints below follow the pattern qq-bridge uses
 * (signed session cookie + /api/remote.mux + session/follow). Adjust the
 * three marked endpoints to match your DSH build; everything else is generic.
 */
export class DshBackend implements AgentBackend {
  readonly mode: BridgeMode = 'dsh';
  private readonly sessions = new Map<string, string>();

  private sign(payload: string): string {
    return createHmac('sha256', config.dsh.signKey || 'dev').update(payload).digest('hex');
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      // DSH authenticates RPC via a locally-signed key. Adjust header name to match.
      'X-DSH-Sign': this.sign(config.dsh.signKey + Date.now()),
      ...extra,
    };
  }

  private async ensureSession(chatId: string): Promise<string> {
    if (this.sessions.has(chatId)) return this.sessions.get(chatId)!;
    // [ADJUST] session creation endpoint for your DSH version.
    const res = await fetch(`${config.dsh.baseUrl}/api/sessions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ id: `qq-${chatId}`, model: config.dsh.model || undefined }),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    const sid = data.id ?? `qq-${chatId}`;
    this.sessions.set(chatId, sid);
    return sid;
  }

  async reply(req: AgentRequest): Promise<AgentReply> {
    const sid = await this.ensureSession(req.chatId);
    const content: Array<{ type: string; text?: string; image_url?: string }> = [
      { type: 'text', text: req.text },
    ];
    for (const img of req.images ?? []) content.push({ type: 'image_url', image_url: img });

    // [ADJUST] message submission endpoint (remote.mux / session/follow).
    const send = await fetch(`${config.dsh.baseUrl}/api/sessions/${sid}/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ role: 'user', content }),
    });
    if (!send.ok) throw new Error(`DSH send failed: ${send.status}`);

    // [ADJUST] reply retrieval. Here we poll the latest assistant message.
    // DSH also supports an SSE `session/follow` stream; switch to streaming
    // if your build provides it.
    let reply = '';
    let images: AgentReply['images'];
    for (let i = 0; i < 30; i++) {
      const poll = await fetch(`${config.dsh.baseUrl}/api/sessions/${sid}/messages?role=assistant`, {
        headers: this.headers(),
      });
      const list = (await poll.json().catch(() => [])) as any[];
      const last = list[list.length - 1];
      if (last?.content) {
        const parts = Array.isArray(last.content) ? last.content : [{ type: 'text', text: last.content }];
        for (const p of parts) {
          if (p.type === 'text' && p.text) reply += p.text;
          if (p.type === 'image' && p.image_url) {
            const buf = await fetch(p.image_url).then((r) => r.arrayBuffer()).catch(() => null);
            if (buf) (images ??= []).push({ data: Buffer.from(buf), mime: 'image/png' });
          }
        }
        if (reply) break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    return { text: reply || '（DSH 无回复）', images };
  }

  reset(chatId: string): void {
    this.sessions.delete(chatId);
  }

  async browserReset(): Promise<void> {
    // In DSH mode the browser is owned by the MCP server; reset via DSH if needed.
  }
}
