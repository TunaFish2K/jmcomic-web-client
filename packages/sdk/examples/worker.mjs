import { createWorkersServer } from 'jmcomic-sdk/workers';
import jpegDec from 'jmcomic-sdk/wasm/mozjpeg_dec.wasm';
import jpegEnc from 'jmcomic-sdk/wasm/mozjpeg_enc.wasm';
import png from 'jmcomic-sdk/wasm/squoosh_png_bg.wasm';
import webpDec from 'jmcomic-sdk/wasm/webp_dec.wasm';
const wasm = { 'jpeg-dec': jpegDec, 'jpeg-enc': jpegEnc, png, 'webp-dec': webpDec };
let server;
export default {
  fetch(request, env) {
    if (!env.JM_TOKEN) return new Response('Configure JM_TOKEN before deployment', { status: 503 });
    server ??= createWorkersServer({ wasm, token: env.JM_TOKEN, allowedOrigins: env.JM_ORIGINS?.split(',') });
    return server.fetch(request);
  },
};
