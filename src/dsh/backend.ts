import type { BridgeMode } from '../config.js';

export interface AgentRequest {
  chatId: string;
  text: string;
  /** base64 data URLs supplied by the user (e.g. an image sent in QQ). */
  images?: string[];
}

export interface AgentImage {
  data: Buffer;
  mime: string;
}

export interface AgentReply {
  text: string;
  images?: AgentImage[];
}

/** Backend that turns a QQ message into a DeepSeek agent reply. */
export interface AgentBackend {
  readonly mode: BridgeMode;
  reply(req: AgentRequest): Promise<AgentReply>;
  /** Clear a chat's conversation history (optional). */
  reset?(chatId: string): void;
  /** Close/reset the controlled browser (optional). */
  browserReset?(): Promise<void>;
}

/** Minimal completion interface used by the browser planner. */
export interface Thinker {
  think(system: string, user: string): Promise<string>;
}
