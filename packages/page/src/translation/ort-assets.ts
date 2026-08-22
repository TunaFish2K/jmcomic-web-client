export const ORT_RUNTIME_VERSION = "1.27.0";

const ORT_ASSET_PREFIX = `ort-wasm-simd-threaded.jsep-${ORT_RUNTIME_VERSION}`;

export const ORT_WASM_GZIP_ASSET_PATH =
    `/assets-v3/${ORT_ASSET_PREFIX}.wasm.gz.bin`;
export const ORT_MJS_ASSET_PATH = `/assets-v3/${ORT_ASSET_PREFIX}.mjs`;
