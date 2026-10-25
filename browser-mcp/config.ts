// Minimal config for the vendored browser MCP server. Values come from the
// environment (set by DSH when it spawns the MCP server) with safe defaults.
export const config = {
  browser: {
    width: Number(process.env.BROWSER_WIDTH ?? 1280),
    height: Number(process.env.BROWSER_HEIGHT ?? 800),
    maxSteps: Number(process.env.BROWSER_MAX_STEPS ?? 25),
  },
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY ?? '',
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
    model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
  },
};
