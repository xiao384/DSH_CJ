import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'npx',
  args: ['tsx', 'src/cli.ts', 'mcp'],
  cwd: process.cwd(),
});
const client = new Client({ name: 'smoke-test', version: '1.0.0' }, { capabilities: {} });
await client.connect(transport);
const tools = await client.listTools();
console.log('TOOLS:', tools.tools.map((t) => t.name).join(', '));
await client.close();
console.log('OK');
