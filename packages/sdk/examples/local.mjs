import { createLocalClient } from 'jmcomic-sdk-pwa/node';
const client = createLocalClient();
try {
  const results = await client.search(process.argv[2] ?? 'example');
  console.log(results);
} finally { client.dispose(); }
