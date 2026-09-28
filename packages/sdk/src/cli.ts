#!/usr/bin/env node
import { createLocalClient, createServer, listen } from './adapters/node.js';

if (process.argv.includes('--help')) {
  console.log('jmcomic-sdk [serve]\nEnvironment: JM_HOST=127.0.0.1 JM_PORT=3000 JM_TOKEN=... JM_ORIGINS=https://app.example JM_DOMAINS=https://upstream.example');
} else {
  const client = createLocalClient({ domains: process.env.JM_DOMAINS?.split(',') });
  const token = process.env.JM_TOKEN;
  const handler = createServer(client, { token, allowedOrigins: process.env.JM_ORIGINS?.split(',') });
  try {
    const server = await listen(handler, { host: process.env.JM_HOST, port: Number(process.env.JM_PORT ?? 3000), tokenConfigured: !!token });
    const address = server.address();
    console.log(`JM SDK listening on ${typeof address === 'object' && address ? `${address.address}:${address.port}` : address}`);
    const close = () => { client.dispose(); server.close(); server.closeAllConnections(); };
    process.once('SIGINT', close); process.once('SIGTERM', close);
  } catch (error) { client.dispose(); console.error(error instanceof Error ? error.message : 'Startup failed'); process.exitCode = 1; }
}
