// Run in a project with jmcomic-sdk-pwa installed, using deno run --allow-net --allow-read --allow-env.
import { createLocalClient } from 'jmcomic-sdk-pwa/node';
import { createServer } from 'jmcomic-sdk-pwa/server';
const client = createLocalClient();
const allowedOrigins = Deno.env.get('JM_ORIGINS')?.split(',').map(value => value.trim()).filter(Boolean);
const handler = createServer(client, { token: Deno.env.get('JM_TOKEN'), allowedOrigins });
const server = Deno.serve({ hostname: '127.0.0.1', port: 3000 }, handler.fetch);
const close = () => { client.dispose(); void server.shutdown(); };
Deno.addSignalListener('SIGINT', close); Deno.addSignalListener('SIGTERM', close);
