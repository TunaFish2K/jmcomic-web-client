import { createLocalClient, createServer, listen } from 'jmcomic-sdk/node';
const client = createLocalClient();
const token = process.env.JM_TOKEN;
await listen(createServer(client, { token }), { port: 3000, tokenConfigured: !!token });
