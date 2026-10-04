// Writes wrangler.deploy.json from wrangler.jsonc, binding ALBUM_CACHE_KV only when ALBUM_CACHE_KV_ID is set.
import { readFileSync, writeFileSync } from 'node:fs';

const source = new URL('../wrangler.jsonc', import.meta.url);
const target = new URL('../wrangler.deploy.json', import.meta.url);
const config = JSON.parse(readFileSync(source, 'utf8'));
const kvId = process.env.ALBUM_CACHE_KV_ID?.trim();

if (kvId) {
	config.kv_namespaces = [{ binding: 'ALBUM_CACHE_KV', id: kvId }];
	console.log('ALBUM_CACHE_KV_ID 已设置，部署时绑定 ALBUM_CACHE_KV。');
} else {
	console.log('未设置 ALBUM_CACHE_KV_ID，部署时不绑定 KV。');
}

writeFileSync(target, JSON.stringify(config, null, '\t') + '\n');
