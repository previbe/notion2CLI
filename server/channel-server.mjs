#!/usr/bin/env node

process.env.NOTION2CLI_RUNTIME = 'claude';
await import('./bridge-server.mjs');
