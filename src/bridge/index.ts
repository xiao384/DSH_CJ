import { config } from '../config.js';
import { OneBotClient, type OBMessageEvent } from '../onebot/client.js';
import { DeepSeekBackend } from '../dsh/deepseekAdapter.js';
import { DshBackend } from '../dsh/dshAdapter.js';
import type { AgentBackend } from '../dsh/backend.js';
import { chatKey, type ChatRef } from '../types.js';
import {
  replyToSegments,
  resolveIncomingImage,
  shouldRespond,
} from './renderer.js';

function chatFromEvent(ev: OBMessageEvent): ChatRef {
  if (ev.message_type === 'group') {
    return { kind: 'group', id: String(ev.group_id), userId: String(ev.user_id) };
  }
  return { kind: 'private', id: String(ev.user_id) };
}

async function handleMessage(ev: OBMessageEvent, ob: OneBotClient, backend: AgentBackend): Promise<void> {
  const chat = chatFromEvent(ev);
  const key = chatKey(chat);

  // Group allow-list
  if (chat.kind === 'group' && config.behavior.allowedGroups.length) {
    if (!config.behavior.allowedGroups.includes(chat.id)) return;
  }

  const { respond, text } = shouldRespond(ev, {
    trigger: config.behavior.groupTrigger,
    selfId: ob.selfId,
    prefix: config.behavior.commandPrefix,
  });
  if (!respond) return;

  const trimmed = text.trim();
  if (!trimmed) return;

  // Slash commands
  if (trimmed.startsWith(config.behavior.commandPrefix)) {
    await handleCommand(trimmed, chat, ob, backend);
    return;
  }

  // Resolve any images the user sent (for multimodal).
  const fileImages = typeof ev.message === 'string' ? [] : ev.message.filter((s) => s.type === 'image').map((s) => (s.data as { file: string }).file);
  const images: string[] = [];
  for (const f of fileImages) {
    const url = await resolveIncomingImage(ob, f);
    if (url) images.push(url);
  }

  try {
    const reply = await backend.reply({ chatId: key, text: trimmed, images: images.length ? images : undefined });
    const segs = replyToSegments(reply, config.behavior.qqMessageLimit);
    if (!segs.length) return;
    await ob.sendTo(chat, segs);
  } catch (e) {
    console.error('[bridge] reply error:', (e as Error).message);
    await ob.sendTo(chat, [{ type: 'text', data: { text: '出错了：' + (e as Error).message } }]);
  }
}

async function handleCommand(
  raw: string,
  chat: ChatRef,
  ob: OneBotClient,
  backend: AgentBackend,
): Promise<void> {
  const key = chatKey(chat);
  const parts = raw.slice(config.behavior.commandPrefix.length).split(/\s+/);
  const cmd = parts[0]?.toLowerCase();
  const isOwner = config.onebot.ownerQq && chat.userId === config.onebot.ownerQq;

  if (cmd === 'reset') {
    backend.reset?.(key);
    await ob.sendTo(chat, [{ type: 'text', data: { text: '已重置当前会话。' } }]);
    return;
  }
  if (cmd === 'browser') {
    const sub = parts[1]?.toLowerCase();
    if (sub === 'reset' || sub === 'close') {
      if (!isOwner && config.bridgeMode !== 'deepseek') {
        await ob.sendTo(chat, [{ type: 'text', data: { text: '仅管理员可重置浏览器。' } }]);
        return;
      }
      await backend.browserReset?.();
      await ob.sendTo(chat, [{ type: 'text', data: { text: '浏览器已关闭/重置。' } }]);
      return;
    }
    await ob.sendTo(chat, [{ type: 'text', data: { text: '用法: /browser reset' } }]);
    return;
  }
  if (cmd === 'help') {
    await ob.sendTo(chat, [{
      type: 'text',
      data: {
        text:
          '我是接入 DeepSeek 的浏览器助手。直接让我"打开xxx网页/看视频/玩网页游戏"即可。\n' +
          '命令: /reset 重置会话, /browser reset 关闭浏览器, /help 帮助。',
      },
    }]);
    return;
  }
}

export async function runBridge(): Promise<void> {
  const ob = new OneBotClient();
  await ob.start();

  // Give the login-info round-trip a moment.
  await new Promise((r) => setTimeout(r, 1500));

  const backend: AgentBackend =
    config.bridgeMode === 'dsh' ? new DshBackend() : new DeepSeekBackend();

  ob.on('message', (ev: OBMessageEvent) => {
    handleMessage(ev, ob, backend).catch((e) => console.error('[bridge] handler error:', e));
  });

  console.log(`[bridge] running in "${config.bridgeMode}" mode; selfId=${ob.selfId || '(pending)'}`);
  console.log('[bridge] waiting for QQ messages...');

  process.on('SIGINT', () => {
    console.log('\n[bridge] shutting down.');
    process.exit(0);
  });
}
