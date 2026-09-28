// Run in a project with jmcomic-sdk installed, using deno run --allow-net --allow-read --allow-env.
import { createLocalClient } from 'jmcomic-sdk/node';
import { createServer } from 'jmcomic-sdk/server';
const client = createLocalClient();
const handler = createServer(client, { token: Deno.env.get('JM_TOKEN') });
Deno.serve({ hostname: '127.0.0.1', port: 3000 }, handler.fetch);
