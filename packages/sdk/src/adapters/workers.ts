import { createLocalClient } from '../local.js';
import { createServer } from '../server.js';
import { MemoryCache } from '../runtime.js';
import type { LocalOptions } from '../local.js';
import type { ServerOptions } from '../server.js';
import type { WasmName } from '../image.js';

export interface WorkersOptions extends Omit<LocalOptions, 'imageProcessor'>, ServerOptions {
  wasm: Record<WasmName, WebAssembly.Module>;
}
/** Instantiate once per isolate; clients and in-flight work are created per request. */
export function createWorkersServer(options: WorkersOptions) {
  const cache = options.cache ?? new MemoryCache(2 * 1024 * 1024);
  return createServer(() => createLocalClient({ ...options, cache, image: {
    maxInputBytes: 8 * 1024 * 1024, maxPixels: 1_500_000, ...options.image,
    loadWasm: async name => options.wasm[name],
  } }), options);
}
