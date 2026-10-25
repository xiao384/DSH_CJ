import { EventEmitter } from 'node:events';
import { WebSocketServer, WebSocket } from 'ws';
import { WebSocket as WS } from 'ws';
import { config } from '../config.js';

/** OneBot v11 message segment. */
export type OBSegment =
  | { type: 'text'; data: { text: string } }
  | { type: 'image'; data: { file: string; url?: string; summary?: string } }
  | { type: 'at'; data: { qq: string | 'all' } }
  | { type: string; data: Record<string, string> };

export interface OBMessageEvent {
  post_type: 'message';
  message_type: 'private' | 'group';
  sub_type?: string;
  message_id: number;
  user_id: number;
  group_id?: number;
  message: string | OBSegment[];
  raw_message?: string;
  sender: { user_id: number; nickname: string; role?: string; [k: string]: unknown };
  self_id?: number;
  time?: number;
}

type APIResponse = { status: string; retcode: number; data?: unknown; echo?: string | number };

/**
 * Minimal OneBot v11 client compatible with SnowLuma / NapCat / Lagrange.
 * Supports both forward WS (connect to the end) and reverse WS (host a server).
 */
export class OneBotClient extends EventEmitter {
  private ws: WS | null = null;
  private server: WebSocketServer | null = null;
  private readonly pending = new Map<string | number, (r: APIResponse) => void>();
  private echoCounter = 1;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  public selfId = 0;

  async start(): Promise<void> {
    if (config.onebot.reversePort > 0) {
      await this.startReverse();
    } else {
      await this.connect(config.onebot.url);
    }
  }

  private startReverse(): Promise<void> {
    return new Promise((resolve) => {
      this.server = new WebSocketServer({ port: config.onebot.reversePort });
      this.server.on('connection', (sock) => {
        this.ws = sock as unknown as WS;
        this.bindSocket();
        resolve();
      });
      this.server.on('listening', () => {
        console.log(`[onebot] reverse WS server listening on :${config.onebot.reversePort}`);
      });
    });
  }

  private connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const full = config.onebot.token ? `${url}?access_token=${encodeURIComponent(config.onebot.token)}` : url;
      const ws = new WS(full, { headers: config.onebot.token ? { Authorization: `Bearer ${config.onebot.token}` } : {} });
      this.ws = ws;
      ws.on('open', () => {
        this.bindSocket();
        resolve();
      });
      ws.on('error', (err) => {
        console.error('[onebot] connection error:', err.message);
        // Don't reject on first failure: keep retrying in background so the
        // bridge survives OneBot being offline at startup.
        if (this.echoCounter === 1) {
          resolve();
          return;
        }
        this.scheduleReconnect();
      });
      ws.on('close', () => this.scheduleReconnect());
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || config.onebot.reversePort > 0) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(config.onebot.url).catch(() => {});
    }, 3000);
  }

  private bindSocket(): void {
    const ws = this.ws!;
    ws.on('message', (buf) => this.onMessage(buf.toString()));
    this.startHeartbeat();
    this.getLoginInfo().then((r) => {
      if (r?.data && typeof r.data === 'object') {
        this.selfId = (r.data as { user_id: number }).user_id ?? 0;
        console.log(`[onebot] logged in as ${this.selfId}`);
      }
    }).catch(() => {});
  }

  private startHeartbeat(): void {
    this.heartbeatTimer?.close();
    this.heartbeatTimer = setInterval(() => {
      this.call('get_status', {}).catch(() => {});
    }, 30000);
  }

  private onMessage(raw: string): void {
    let payload: any;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    if (payload.echo !== undefined && this.pending.has(payload.echo)) {
      const cb = this.pending.get(payload.echo)!;
      this.pending.delete(payload.echo);
      cb(payload as APIResponse);
      return;
    }
    if (payload.post_type === 'message') {
      this.emit('message', payload as OBMessageEvent);
    }
  }

  /** Call an OneBot API and await its response. */
  call<T = unknown>(action: string, params: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WS.OPEN) {
        reject(new Error('onebot not connected'));
        return;
      }
      const echo = this.echoCounter++;
      this.pending.set(echo, (r) => {
        if (r.retcode === 0 || r.status === 'ok') resolve(r.data as T);
        else reject(new Error(`onebot ${action} failed: ${r.status} (${r.retcode})`));
      });
      this.ws.send(JSON.stringify({ action, params, echo }));
      setTimeout(() => {
        if (this.pending.has(echo)) {
          this.pending.delete(echo);
          reject(new Error(`onebot ${action} timeout`));
        }
      }, 20000);
    });
  }

  getLoginInfo(): Promise<{ data?: unknown }> {
    return this.call('get_login_info', {});
  }

  /** Send a message. `message` is an array of OneBot segments. */
  async sendMessage(opts: {
    userId?: number;
    groupId?: number;
    message: OBSegment[];
  }): Promise<number> {
    const params: Record<string, unknown> = { message: opts.message };
    if (opts.groupId) params.group_id = opts.groupId;
    else params.user_id = opts.userId;
    const r = await this.call<{ message_id: number }>('send_msg', params);
    return r.message_id;
  }

  /** Convenience: send plain text (+ optional images) to a chat. */
  async sendTo(
    chat: { kind: 'private' | 'group'; id: string },
    segments: OBSegment[],
  ): Promise<void> {
    if (chat.kind === 'group') await this.sendMessage({ groupId: Number(chat.id), message: segments });
    else await this.sendMessage({ userId: Number(chat.id), message: segments });
  }

  /** Extract plain text + mentioned bot from an incoming message. */
  static extractText(msg: string | OBSegment[], selfId = 0): { text: string; atBot: boolean; images: string[] } {
    let text = '';
    let atBot = false;
    const images: string[] = [];
    const segs: OBSegment[] = typeof msg === 'string' ? parseCQ(msg) : msg;
    for (const s of segs) {
      if (s.type === 'text') text += (s.data as { text: string }).text;
      else if (s.type === 'image') images.push((s.data as { file: string }).file);
      else if (s.type === 'at') {
        const qq = (s.data as { qq: string | 'all' }).qq;
        if (qq === 'all' || (selfId && Number(qq) === selfId)) atBot = true;
      }
    }
    return { text: text.trim(), atBot, images };
  }
}

/** Naive CQ-code string parser (handles [CQ:type,key=value,...]). */
export function parseCQ(raw: string): OBSegment[] {
  const segs: OBSegment[] = [];
  const re = /\[CQ:([a-z_]+)((?:,[a-z_]+=[^,\]]*)*)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    if (m.index > last) segs.push({ type: 'text', data: { text: raw.slice(last, m.index) } });
    const type = m[1];
    const data: Record<string, string> = {};
    for (const kv of m[2].slice(1).split(',')) {
      const [k, v] = kv.split('=');
      if (k) data[k] = decodeCQ(v ?? '');
    }
    segs.push({ type, data } as OBSegment);
    last = re.lastIndex;
  }
  if (last < raw.length) segs.push({ type: 'text', data: { text: raw.slice(last) } });
  return segs;
}

function decodeCQ(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#91;/g, '[')
    .replace(/&#93;/g, ']')
    .replace(/&#44;/g, ',');
}

export { WebSocket };
