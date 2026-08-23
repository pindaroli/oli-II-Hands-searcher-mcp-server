import log, { LogLevel } from '@apify/log';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools.js';
import { registerHardwarePrompt, getAiConfig } from 'shared-mcp-utils';

// Ensure Apify logger doesn't emit ANSI escape characters or pollute stdio
log.setLevel(LogLevel.OFF);

const SERVER_NAME = 'mcp-server-subito-scraper';
const SERVER_VERSION = '1.0.0';

function parseArgs(): void {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      console.log(`
Uso: mcp-server-subito-scraper [opzioni]

Opzioni:
  --help, -h          Mostra questo messaggio di aiuto
  --token, -t         Specifica l'Apify API Token
      `);
      process.exit(0);
    }

    if ((arg === '--token' || arg === '-t' || arg === '--apify-token') && i + 1 < args.length) {
      process.env.APIFY_TOKEN = args[i + 1];
      i++;
    }
  }
}

async function preloadOllamaModel(): Promise<void> {
  const config = getAiConfig();
  if (!config.isEnabled || !config.model) {
    return;
  }

  // Preload only makes sense for local Ollama endpoints (localhost / 127.0.0.1)
  const isLocal = config.baseUrl.includes('localhost') || config.baseUrl.includes('127.0.0.1');
  if (!isLocal) {
    return;
  }

  console.error(`[Preload] Avvio precaricamento asincrono del modello ${config.model}...`);
  const endpoint = `${config.baseUrl}/api/generate`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.model
      }),
      signal: controller.signal
    })
      .then((res) => {
        clearTimeout(timer);
        if (res.ok) {
          console.error(`[Preload] Modello ${config.model} caricato in memoria con successo.`);
        } else {
          console.error(`[Preload] Richiesta inviata ma Ollama ha risposto con codice ${res.status}`);
        }
      })
      .catch((err) => {
        clearTimeout(timer);
        console.error(`[Preload] Errore durante il caricamento del modello: ${err.message}`);
      });
  } catch (err: any) {
    console.error(`[Preload] Impossibile avviare la richiesta: ${err.message}`);
  }
}

export async function startMcpServer(): Promise<void> {
  parseArgs();

  // Initialize MCP Server instance
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION
    },
    {
      capabilities: {
        tools: {},
        prompts: {}
      }
    }
  );

  // Register MCP tools
  registerTools(server);

  // Register hardware verification prompt
  registerHardwarePrompt(server);

  // Preload Ollama model asynchronously at startup (non-blocking)
  preloadOllamaModel();

  // Connect to stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`[${SERVER_NAME}] Server running on stdio transport (Apify Actor: azzouzana/subito-scraper-pro-by-search-url)`);
}
