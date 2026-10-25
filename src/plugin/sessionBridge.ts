import type { OneBotClient, OBMessageEvent } from '../onebot/client.js';
import { config } from '../config.js';
import { chatKey, type ChatRef } from '../types.js';
import { shouldRespond, replyToSegments, resolveIncomingImage } from '../bridge/renderer.js';

/**
 * Bridges QQ (OneBot) messages into DSH sessions and sends the agent reply back
 * to QQ. This is the "qq-bridge equivalent" running *inside* DSH.
 *
 * IMPORTANT: the exact `ctx.sessions` / agent-loop API varies by DSH build.
 * Every call below is marked [DSH-ADJUST] and wrapped in try/catch so a
 * mismatch logs a clear message instead of crashing the plugin. Align these to
 * your DSH version, then enable with DSH_INPROC_BRIDGE=1.
 */
export function runSessionBridge(ctx: any, ob: OneBotClient): { onMessage: (ev: OBMessageEvent) => void; dispose: () => void } {
  const sessions = new Map<string, string>();

  function chatFromEvent(ev: OBMessageEvent): ChatRef {
    if (ev.message_type === 'group') return { kind: 'group', id: String(ev.group_id), userId: String(ev.user_id) };
    return { kind: 'private', id: String(ev.user_id) };
  }

  async function ensureSession(chatKey: string): Promise<string> {
    if (sessions.has(chatKey)) return sessions.get(chatKey)!;
    // [DSH-ADJUST] create/get a session for this chat.
    // Likely one of:
    //   const s = await ctx.sessions.create({ id: chatKey, model: config.dsh.model })
    //   const s = await ctx.agents.start({ id: chatKey })
    const s = await ctx.sessions.create({ id: chatKey, model: config.dsh.model || undefined });
    const id = (s?.id ?? s?.sessionId ?? chatKey) as string;
    sessions.set(chatKey, id);
    return id;
  }

  async function onMessage(ev: OBMessageEvent): Promise<void> {
    try {
      const chat = chatFromEvent(ev);
      if (chat.kind === 'group' && config.behavior.allowedGroups.length && !config.behavior.allowedGroups.includes(chat.id)) return;
      const { respond, text } = shouldRespond(ev, {
        trigger: config.behavior.groupTrigger,
        selfId: ob.selfId,
        prefix: config.behavior.commandPrefix,
      });
      if (!respond || !text.trim()) return;

      // Slash commands
      if (text.trim().startsWith(config.behavior.commandPrefix)) {
        const cmd = text.trim().slice(1).split(/\s+/)[0]?.toLowerCase();
        if (cmd === 'reset') {
          sessions.delete(chatKey(chat));
          await ob.sendTo(chat, [{ type: 'text', data: { text: '已重置当前会话。' } }]);
          return;
        }
      }

      const key = chatKey(chat);
      const sid = await ensureSession(key);

      // Resolve any images the user sent into base64 data URLs.
      const fileImages =
        typeof ev.message === 'string'
          ? []
          : ev.message.filter((s) => s.type === 'image').map((s) => (s.data as { file: string }).file);
      const images: string[] = [];
      for (const f of fileImages) {
        const url = await resolveIncomingImage(ob, f);
        if (url) images.push(url);
      }

      // [DSH-ADJUST] send the user turn and obtain the agent reply.
      // Likely shape:
      //   const reply = await ctx.sessions.send({
      //     sessionId: sid, role: 'user',
      //     content: text, images: images.length ? images : undefined,
      //   })
      const reply: any = await ctx.sessions.send({
        sessionId: sid,
        role: 'user',
        content: text,
        images: images.length ? images : undefined,
      });

      const text2: string = reply?.text ?? reply?.content ?? String(reply ?? '');
      const imgs: { data: Buffer; mime: string }[] = Array.isArray(reply?.images)
        ? reply.images.map((i: any) => ({ data: Buffer.from(i.data ?? '', 'base64'), mime: i.mime ?? 'image/png' }))
        : [];
      const segs = replyToSegments({ text: text2, images: imgs }, config.behavior.qqMessageLimit);
      if (segs.length) await ob.sendTo(chat, segs);
    } catch (e) {
      console.error('[session-bridge] DSH-ADJUST needed:', (e as Error).message);
    }
  }

  return {
    onMessage,
    dispose() {
      sessions.clear();
    },
  };
}
