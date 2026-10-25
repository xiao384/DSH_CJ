import { runBridge } from './bridge/index.js';
import { runMcpServer } from './browser/mcpServer.js';

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'bridge';
  if (mode === 'mcp') {
    await runMcpServer();
  } else if (mode === 'bridge') {
    await runBridge();
  } else {
    console.error(`Unknown mode "${mode}". Use "bridge" or "mcp".`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
