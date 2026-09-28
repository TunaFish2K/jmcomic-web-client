import { createLocalClient } from 'jmcomic-sdk-pwa/node';
import { createServer } from 'jmcomic-sdk-pwa/server';
const client = createLocalClient();
const allowedOrigins = Bun.env.JM_ORIGINS?.split(',').map(value => value.trim()).filter(Boolean);
const handler = createServer(client, { token: Bun.env.JM_TOKEN, allowedOrigins });
const server = Bun.serve({ hostname: '127.0.0.1', port: 3000, fetch: handler.fetch });
const close = () => { client.dispose(); server.stop(true); };
process.once('SIGINT', close); process.once('SIGTERM', close);
