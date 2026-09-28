import { createLocalClient, createNodeWasmLoader } from 'jmcomic-sdk/node';
import { createServer } from 'jmcomic-sdk/server';
const client = createLocalClient({ image: { loadWasm: createNodeWasmLoader() } });
const handler = createServer(client, { token: Bun.env.JM_TOKEN });
Bun.serve({ hostname: '127.0.0.1', port: 3000, fetch: handler.fetch });
