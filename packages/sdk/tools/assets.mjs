import { cp, mkdir } from 'node:fs/promises';
const assets = {
  'mozjpeg_dec.wasm': '@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm',
  'mozjpeg_enc.wasm': '@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm',
  'squoosh_png_bg.wasm': '@jsquash/png/codec/pkg/squoosh_png_bg.wasm',
  'webp_dec.wasm': '@jsquash/webp/codec/dec/webp_dec.wasm',
};
await mkdir('dist/wasm', { recursive: true });
for (const [name, path] of Object.entries(assets)) await cp(`node_modules/${path}`, `dist/wasm/${name}`);
await cp('node_modules/@jsquash/jpeg/LICENSE', 'dist/wasm/LICENSE-jsquash');
