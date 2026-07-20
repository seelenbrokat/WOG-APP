#!/usr/bin/env node
/**
 * WOG Portal MCP-Server (stdio)
 *
 * Env:
 *   WOG_API_URL       – default https://wog.logistikberater.at/api
 *   WOG_EMAIL         – Portal-Login
 *   WOG_PASSWORD      – Portal-Passwort
 *   WOG_ACCESS_TOKEN  – alternativ fertiges JWT
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WogApiClient } from './client.js';
import { registerStatusTools } from './tools/status.js';
import { registerOrderTools } from './tools/orders.js';

async function main() {
  const client = new WogApiClient();
  const server = new McpServer({
    name: 'wog-portal',
    version: '1.0.0',
  });

  registerStatusTools(server, client);
  registerOrderTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[wog-mcp] verbunden (stdio) → ${client.getApiUrl()}`,
  );
}

main().catch((err) => {
  console.error('[wog-mcp] Start fehlgeschlagen:', err);
  process.exit(1);
});
