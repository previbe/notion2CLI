#!/usr/bin/env node

process.env.NOTION2CLI_RUNTIME = 'claude-channel';
const { startBridgeServer } = await import('./bridge-server.mjs');

await startBridgeServer();
