import { createLocalClient, createServer, listen } from 'jmcomic-sdk-pwa/node';
const client = createLocalClient();
const token = process.env.JM_TOKEN;
const allowedOrigins = process.env.JM_ORIGINS?.split(',').map(value => value.trim()).filter(Boolean);
try {
  const server = await listen(createServer(client, { token, allowedOrigins }), {
    host: process.env.JM_HOST, port: Number(process.env.JM_PORT ?? 3000), tokenConfigured: !!token,
  });
  const close = () => { client.dispose(); server.close(); server.closeAllConnections(); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
} catch (error) { client.dispose(); throw error; }
