import { createRemoteClient } from 'jmcomic-sdk/remote';
const client = createRemoteClient({ baseUrl: 'http://127.0.0.1:3000', token: process.env.JM_TOKEN });
try { console.log(await client.search(process.argv[2] ?? 'example')); }
finally { client.dispose(); }
