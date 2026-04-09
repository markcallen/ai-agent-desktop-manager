#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { appVersion } from '../util/app-version.js';
import { desktopToolDefinitions, invokeDesktopTool } from '../mcp/tools.js';

const server = new McpServer({
  name: 'ai-agent-desktop-manager',
  version: appVersion
});

for (const tool of desktopToolDefinitions) {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.inputSchema
    },
    async (args: Record<string, unknown>) =>
      await invokeDesktopTool(tool.name, args)
  );
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(String((error as Error)?.stack ?? error));
  process.exit(1);
});
