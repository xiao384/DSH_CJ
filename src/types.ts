// Shared types across the bridge and browser subsystems.

/** A piece of an agent reply that the bridge renders into QQ messages. */
export interface ReplyPart {
  type: 'text' | 'image';
  /** Text content, or a description for images. */
  text?: string;
  /** Image bytes (PNG/JPEG). */
  data?: Buffer;
  /** MIME type for image parts. */
  mime?: string;
}

/** Full agent reply: ordered parts the bridge sends to QQ. */
export type Reply = ReplyPart[];

/** Chat identity inside QQ, used as a stable session key. */
export interface ChatRef {
  kind: 'private' | 'group';
  /** user id (private) or group id (group). */
  id: string;
  /** sender user id, used for per-user session context in groups. */
  userId?: string;
}

export function chatKey(chat: ChatRef): string {
  if (chat.kind === 'private') return `priv:${chat.id}`;
  // In groups we keep one shared group session but remember the sender.
  return `grp:${chat.id}`;
}

/** Result of executing one browser tool. */
export interface ToolResult {
  text?: string;
  image?: Buffer;
  mime?: string;
}

/** An MCP / agent tool description shared by the bridge loop and MCP server. */
export interface ToolDef {
  name: string;
  description: string;
  /** JSON-schema-ish parameters (kept simple). */
  parameters: Record<string, unknown>;
}
