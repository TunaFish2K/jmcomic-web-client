#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createLocalClient, createServer, listen } from './adapters/node.js';

const args = process.argv.slice(2);
const help = 'jmcomic-sdk-pwa [serve]\njmcomic-sdk-pwa --help | --version\nEnvironment: JM_HOST=127.0.0.1 JM_PORT=3000 JM_TOKEN=... JM_ORIGINS=https://app.example JM_DOMAINS=https://upstream.example JM_DEBUG=1';
const list = (value?: string) => value?.split(',').map(item => item.trim()).filter(Boolean);

async function main() {
  if (args.length === 1 && args[0] === '--help') { console.log(help); return; }
  if (args.length === 1 && args[0] === '--version') {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    console.log(manifest.version); return;
  }
  if (args.length && (args.length !== 1 || args[0] !== 'serve'))
    throw new Error('Unknown command or option. Run jmcomic-sdk-pwa --help.');
  const rawPort = process.env.JM_PORT ?? '3000';
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error('JM_PORT must be an integer between 0 and 65535.');
  const client = createLocalClient({
    domains: list(process.env.JM_DOMAINS),
    logger: process.env.JM_DEBUG === '1' ? event => console.error(JSON.stringify(event)) : undefined,
  });
  try {
    const token = process.env.JM_TOKEN;
    const handler = createServer(client, { token, allowedOrigins: list(process.env.JM_ORIGINS) });
    const server = await listen(handler, { host: process.env.JM_HOST, port, tokenConfigured: !!token });
    const address = server.address();
    console.log(`JM SDK listening on ${typeof address === 'object' && address ? `${address.address}:${address.port}` : address}`);
    const close = () => { client.dispose(); server.close(); server.closeAllConnections(); };
    process.once('SIGINT', close); process.once('SIGTERM', close);
  } catch (error) { client.dispose(); throw error; }
}

try { await main(); }
catch (error) { console.error(error instanceof Error ? error.message : 'Startup failed'); process.exitCode = 1; }
