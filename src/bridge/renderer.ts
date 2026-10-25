import { readFile } from 'node:fs/promises';
import type { OneBotClient, OBSegment } from '../onebot/client.js';
import type { AgentReply } from '../dsh/backend.js';
import type { OBMessageEvent } from '../onebot/client.js';

/** Split long text into QQ-sized text segments. */
export function textToSegments(text: string, limit: number): OBSegment[] {
  const out: OBSegment[] = [];
  let rest = text;
  while (rest.length > limit) {
    out.push({ type: 'text', data: { text: rest.slice(0, limit) } });
    rest = rest.slice(limit);
  }
  if (rest) out.push({ type: 'text', data: { text: rest } });
  return out;
}

/** Render an agent reply (text + images) into OneBot message segments. */
export function replyToSegments(reply: AgentReply, limit: number): OBSegment[] {
  const segs = textToSegments(reply.text ?? '', limit);
  for (const img of reply.images ?? []) {
    segs.push({ type: 'image', data: { file: `base64://${img.data.toString('base64')}` } });
  }
  return segs;
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/** Resolve an incoming OneBot image `file` (path/base64/url) to a base64 data URL. */
export async function resolveIncomingImage(ob: OneBotClient, file: string): Promise<string | null> {
  try {
    if (file.startsWith('base64://')) {
      return 'data:image/png;base64,' + file.slice('base64://'.length);
    }
    if (file.startsWith('http://') || file.startsWith('https://')) {
      const r = await fetch(file);
      const buf = Buffer.from(await r.arrayBuffer());
      const mime = r.headers.get('content-type') || 'image/png';
      return `data:${mime};base64,${buf.toString('base64')}`;
    }
    // Local file reference: ask OneBot for the absolute path.
    const r = await ob.call<{ file?: string }>('get_image', { file });
    if (!r.file) return null;
    const buf = await readFile(r.file);
    const ext = r.file.split('.').pop()?.toLowerCase() || 'png';
    const mime = MIME_BY_EXT[ext] || 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/** Whether an incoming message should trigger a reply, and the cleaned text. */
export function shouldRespond(
  ev: OBMessageEvent,
  opts: { trigger: 'mention' | 'prefix' | 'always'; selfId: number; prefix: string },
): { respond: boolean; text: string } {
  const segs = typeof ev.message === 'string' ? [] : ev.message;
  const text =
    typeof ev.message === 'string'
      ? ev.message
      : segs
          .filter((s) => s.type === 'text')
          .map((s) => (s.data as { text: string }).text)
          .join('');

  if (ev.message_type === 'private') {
    return { respond: true, text: text.trim() };
  }
  // Group
  const atBot = segs.some(
    (s) => s.type === 'at' && ((s.data as { qq: string }).qq === String(opts.selfId) || (s.data as { qq: string }).qq === 'all'),
  );
  const startsWithPrefix = text.trimStart().startsWith(opts.prefix);
  if (opts.trigger === 'always') return { respond: true, text: text.trim() };
  if (opts.trigger === 'mention') return { respond: atBot, text: stripMention(text) };
  if (opts.trigger === 'prefix') return { respond: startsWithPrefix, text: text.trim().slice(opts.prefix.length).trim() };
  return { respond: false, text: '' };
}

function stripMention(text: string): string {
  return text.replace(/\[CQ:at,qq=\d+\]/g, '').replace(/@\S+/g, '').trim();
}
