// Bundle this entry; serve copied jmcomic-sdk-pwa/dist/wasm assets under /wasm/.
import { createRemoteClient } from 'jmcomic-sdk-pwa/remote';
import { createImageProcessor, createUrlWasmLoader } from 'jmcomic-sdk-pwa/image';

// Start the CLI with JM_TOKEN and JM_ORIGINS matching this page's origin.
export function createBrowserClient({ baseUrl = 'http://127.0.0.1:3000', token } = {}) {
  return createRemoteClient({ baseUrl, token });
}
export function createBrowserImages(baseUrl = new URL('/wasm/', location.href)) {
  return createImageProcessor({ loadWasm: createUrlWasmLoader(baseUrl) });
}
// const client = createBrowserClient({ token: 'local-example-token' });
// try { console.log(await client.search('example')); } finally { client.dispose(); }
// const image = await createBrowserImages().process(inputBytes, sliceCount, { format: 'png' });
