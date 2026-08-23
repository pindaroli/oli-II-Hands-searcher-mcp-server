#!/usr/bin/env node

import { startMcpServer } from './mcp-server.js';

startMcpServer().catch((error) => {
  console.error('[mcp-server-subito-scraper] Fatal error in server:', error);
  process.exit(1);
});
