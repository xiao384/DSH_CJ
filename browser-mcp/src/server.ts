import { runMcpServer } from './mcpServer.js';

runMcpServer().catch((e) => {
  console.error('[browser-mcp] fatal:', e);
  process.exit(1);
});
