import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { config } from '../config.js';
import { BrowserController } from './controller.js';
import { browserTools, type ToolContext } from './tools.js';
import type { Thinker } from './planner.js';

/** Minimal DeepSeek-backed thinker for the autonomous browser_task tool. */
function makeThinker(): Thinker | undefined {
  if (!config.deepseek.apiKey) return undefined;
  return {
    async think(system, user) {
      const res = await fetch(`${config.deepseek.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.deepseek.apiKey}`,
        },
        body: JSON.stringify({ model: config.deepseek.model, messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ] }),
      });
      const j = await res.json().catch(() => ({}));
      return j?.choices?.[0]?.message?.content?.toString() ?? '';
    },
  };
}

export async function runMcpServer(): Promise<void> {
  const controller = new BrowserController();
  const thinker = makeThinker();
  const ctx: ToolContext = { controller, thinker };

  const server = new Server(
    { name: 'dsh-browser-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  const tools: Tool[] = browserTools.map((t) => ({
    name: t.def.name,
    description: t.def.description,
    inputSchema: t.def.parameters as unknown as Tool['inputSchema'],
  }));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = browserTools.find((t) => t.def.name === request.params.name);
    if (!tool) return { content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }] };
    try {
      const r = await tool.run(request.params.arguments ?? {}, ctx);
      const content: any[] = [];
      if (r.text) content.push({ type: 'text', text: r.text });
      if (r.image) {
        content.push({ type: 'image', data: r.image.toString('base64'), mimeType: r.mime ?? 'image/png' });
      }
      if (!content.length) content.push({ type: 'text', text: '(no output)' });
      return { content };
    } catch (e) {
      return { content: [{ type: 'text', text: `Tool error: ${(e as Error).message}` }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[browser-mcp] MCP server started on stdio');
  // Keep the process alive; browser stays open until stdin closes.
  process.on('SIGINT', async () => {
    await controller.close();
    process.exit(0);
  });
}
