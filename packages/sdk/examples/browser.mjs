// Bundle this entry; serve copied jmcomic-sdk/dist/wasm assets under /wasm/.
import { createRemoteClient } from 'jmcomic-sdk/remote';
import { createImageProcessor, createUrlWasmLoader } from 'jmcomic-sdk/image';
export const client = createRemoteClient({ baseUrl: 'https://your-sdk-server.example/' });
export const images = createImageProcessor({ loadWasm: createUrlWasmLoader(new URL('/wasm/', location.href)) });
// await client.search('example');
// await images.process(new Uint8Array(await file.arrayBuffer()), sliceCount, { format: 'png' });
