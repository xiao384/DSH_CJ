import 'dotenv/config';

function str(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function list(name: string): string[] {
  const v = str(name);
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

export type BridgeMode = 'dsh' | 'deepseek';
export type GroupTrigger = 'mention' | 'prefix' | 'always';

export const config = {
  bridgeMode: (str('BRIDGE_MODE', 'dsh') as BridgeMode),

  onebot: {
    url: str('ONEBOT_URL', 'ws://127.0.0.1:3001'),
    token: str('ONEBOT_TOKEN'),
    reversePort: int('ONEBOT_REVERSE_PORT', 0),
    ownerQq: str('OWNER_QQ'),
  },

  dsh: {
    baseUrl: str('DSH_BASE_URL', 'http://127.0.0.1:3080'),
    signKey: str('DSH_SIGN_KEY'),
    model: str('DSH_MODEL'),
  },

  deepseek: {
    apiKey: str('DEEPSEEK_API_KEY'),
    baseUrl: str('DEEPSEEK_BASE_URL', 'https://api.deepseek.com'),
    model: str('DEEPSEEK_MODEL', 'deepseek-chat'),
  },

  browser: {
    mcpCmd: str('BROWSER_MCP_CMD', 'npx tsx src/cli.ts mcp'),
    maxSteps: int('BROWSER_MAX_STEPS', 20),
    width: int('BROWSER_WIDTH', 1280),
    height: int('BROWSER_HEIGHT', 800),
  },

  behavior: {
    allowedGroups: list('ALLOWED_GROUPS'),
    groupTrigger: (str('GROUP_TRIGGER', 'mention') as GroupTrigger),
    commandPrefix: str('COMMAND_PREFIX', '/'),
    qqMessageLimit: int('QQ_MESSAGE_LIMIT', 1500),
  },
};

export type AppConfig = typeof config;
