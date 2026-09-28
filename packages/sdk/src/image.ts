import { JmError, checkSignal, integer } from './errors.js';
import { Gate } from './runtime.js';
import type { ImageOptions, ImageResult } from './types.js';
export { sliceCount } from './protocol.js';

export type WasmName = 'jpeg-dec' | 'jpeg-enc' | 'png' | 'webp-dec';
export type WasmLoader = (name: WasmName) => Promise<WebAssembly.Module>;
export interface ImageProcessorOptions {
  loadWasm?: WasmLoader; maxInputBytes?: number; maxPixels?: number;
}
export interface Raster { data: Uint8ClampedArray; width: number; height: number }
export interface ImageProcessor {
  readonly maxInputBytes: number;
  process(data: Uint8Array, slices: number, options?: ImageOptions): Promise<ImageResult>;
}
const names = { 'jpeg-dec': 'mozjpeg_dec.wasm', 'jpeg-enc': 'mozjpeg_enc.wasm', png: 'squoosh_png_bg.wasm', 'webp-dec': 'webp_dec.wasm' };
export function createUrlWasmLoader(base = new URL('./wasm/', import.meta.url)): WasmLoader {
  const modules = new Map<WasmName, Promise<WebAssembly.Module>>();
  return name => {
    let promise = modules.get(name);
    if (!promise) {
      promise = (async () => {
        const response = await fetch(new URL(names[name], base));
        if (!response.ok) throw new JmError('INTERNAL', 'WASM asset could not be loaded');
        return WebAssembly.compile(await response.arrayBuffer());
      })();
      modules.set(name, promise);
      void promise.catch(() => modules.delete(name));
    }
    return promise;
  };
}
// jSquash holds module state globally. Serialize initialization and codec use
// across processors, also bounding the aggregate image memory in an isolate.
const codecGate = new Gate(1, 16);
const initialized = new Map<WasmName, Promise<void>>();
async function codec(name: WasmName, load: WasmLoader): Promise<void> {
  if (!initialized.has(name)) {
    const promise = (async () => {
      const module = await load(name);
      if (name === 'png') {
        const [dec, enc] = await Promise.all([import('@jsquash/png/decode.js'), import('@jsquash/png/encode.js')]);
        await dec.init(module); await enc.init(module);
      } else {
        const implementation = name === 'jpeg-dec' ? await import('@jsquash/jpeg/decode.js')
          : name === 'jpeg-enc' ? await import('@jsquash/jpeg/encode.js') : await import('@jsquash/webp/decode.js');
        // Upstream JS supports compiled modules; its declaration omits this overload.
        await (implementation.init as (module: WebAssembly.Module) => Promise<void>)(module);
      }
    })();
    initialized.set(name, promise);
    void promise.catch(() => initialized.delete(name));
  }
  await initialized.get(name);
}

export function imageInfo(bytes: Uint8Array): { mime: string; width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at: number, len: number) => new TextDecoder().decode(bytes.subarray(at, at + len));
  try {
    if (bytes.length >= 24 && bytes[0] === 137 && ascii(1, 3) === 'PNG' && ascii(12, 4) === 'IHDR')
      return { mime: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
    if (bytes.length >= 10 && ['GIF87a', 'GIF89a'].includes(ascii(0, 6)))
      return { mime: 'image/gif', width: view.getUint16(6, true), height: view.getUint16(8, true) };
    if (bytes[0] === 255 && bytes[1] === 216) {
      let offset = 2;
      while (offset < bytes.length) {
        if (bytes[offset++] !== 255) break;
        while (bytes[offset] === 255) offset++;
        const marker = bytes[offset++]!;
        if (marker === 217 || marker === 218) break;
        if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
        const size = view.getUint16(offset);
        if (size < 2) break;
        if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker))
          return { mime: 'image/jpeg', width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
        offset += size;
      }
    }
    if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
      for (let offset = 12; offset + 8 <= bytes.length;) {
        const tag = ascii(offset, 4), size = view.getUint32(offset + 4, true), p = offset + 8;
        if (tag === 'VP8X') {
          if (bytes[p]! & 2) throw new JmError('UNSUPPORTED_IMAGE', 'Animated WebP processing is not supported');
          const u24 = (i: number) => bytes[i]! + bytes[i + 1]! * 256 + bytes[i + 2]! * 65536;
          return { mime: 'image/webp', width: u24(p + 4) + 1, height: u24(p + 7) + 1 };
        }
        if (tag === 'VP8L' && bytes[p] === 47) {
          const bits = view.getUint32(p + 1, true);
          return { mime: 'image/webp', width: (bits & 16383) + 1, height: ((bits >>> 14) & 16383) + 1 };
        }
        if (tag === 'VP8 ' && bytes[p + 3] === 157 && bytes[p + 4] === 1 && bytes[p + 5] === 42)
          return { mime: 'image/webp', width: view.getUint16(p + 6, true) & 16383, height: view.getUint16(p + 8, true) & 16383 };
        offset = p + size + (size % 2);
      }
    }
  } catch (error) { if (error instanceof JmError) throw error; }
  throw new JmError('UNSUPPORTED_IMAGE', 'Invalid or unsupported image header');
}

export function restoreRows(source: Raster, slices: number): Raster {
  integer(slices, 0, 256, 'slice count');
  if (!slices) return source;
  if (slices > source.height) throw new JmError('INVALID_RESPONSE', 'Image is shorter than its slice count');
  const { width, height } = source;
  const data = new Uint8ClampedArray(source.data.length);
  const base = Math.floor(height / slices), remainder = height % slices, row = width * 4;
  for (let i = 0; i < slices; i++) {
    const sy = height - base * (i + 1) - remainder;
    const dy = base * i + (i ? remainder : 0);
    const rows = base + (i ? 0 : remainder);
    data.set(source.data.subarray(sy * row, (sy + rows) * row), dy * row);
  }
  return { data, width, height };
}

/** One global bilinear transform, after row restoration. Never scale individual slices. */
export function resize(source: Raster, maxSide?: number): Raster {
  if (!maxSide || Math.max(source.width, source.height) <= maxSide) return source;
  const scale = maxSide / Math.max(source.width, source.height);
  const width = Math.max(1, Math.round(source.width * scale)), height = Math.max(1, Math.round(source.height * scale));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.max(0, Math.min(source.height - 1, (y + .5) * source.height / height - .5));
    const y0 = Math.floor(sy), y1 = Math.min(source.height - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < width; x++) {
      const sx = Math.max(0, Math.min(source.width - 1, (x + .5) * source.width / width - .5));
      const x0 = Math.floor(sx), x1 = Math.min(source.width - 1, x0 + 1), fx = sx - x0;
      for (let c = 0; c < 4; c++) {
        const top = source.data[(y0 * source.width + x0) * 4 + c]! * (1 - fx) + source.data[(y0 * source.width + x1) * 4 + c]! * fx;
        const bottom = source.data[(y1 * source.width + x0) * 4 + c]! * (1 - fx) + source.data[(y1 * source.width + x1) * 4 + c]! * fx;
        data[(y * width + x) * 4 + c] = top * (1 - fy) + bottom * fy;
      }
    }
  }
  return { data, width, height };
}
export function validateImageOptions(options: ImageOptions): void {
  if (options.maxSide !== undefined) integer(options.maxSide, 1, 32768, 'maximum side');
  if (options.quality !== undefined) integer(options.quality, 1, 100, 'quality');
  if (options.format !== undefined && !['jpeg', 'png', 'original'].includes(options.format))
    throw new JmError('INVALID_ARGUMENT', 'Invalid image format');
}
export function createImageProcessor(options: ImageProcessorOptions = {}): ImageProcessor {
  const load = options.loadWasm ?? createUrlWasmLoader();
  const maxInputBytes = integer(options.maxInputBytes ?? 16 * 1024 * 1024, 1, 256 * 1024 * 1024, 'image byte limit');
  const maxPixels = integer(options.maxPixels ?? 8_000_000, 1, 64_000_000, 'pixel limit');
  return {
    maxInputBytes,
    async process(bytes, slices, request = {}) {
      validateImageOptions(request); integer(slices, 0, 256, 'slice count'); checkSignal(request.signal);
      if (bytes.byteLength > maxInputBytes) throw new JmError('IMAGE_LIMIT', 'Image exceeds byte limit');
      const info = imageInfo(bytes);
      if (!(info.width > 0 && info.height > 0) || info.width * info.height > maxPixels)
        throw new JmError('IMAGE_LIMIT', 'Image exceeds pixel limit');
      if (info.mime === 'image/gif') {
        if (slices || request.maxSide && Math.max(info.width, info.height) > request.maxSide)
          throw new JmError('UNSUPPORTED_IMAGE', 'GIF is supported only as an unchanged image');
        return { ...info, data: bytes.slice() };
      }
      if (request.format === 'original') {
        if (slices || request.maxSide && Math.max(info.width, info.height) > request.maxSide)
          throw new JmError('INVALID_ARGUMENT', 'Original format requires an unchanged image');
        return { ...info, data: bytes.slice() };
      }
      return codecGate.run(request.signal, async () => {
        try {
          const input = bytes.slice().buffer;
          let raster: Raster;
          if (info.mime === 'image/png') {
            await codec('png', load); raster = await (await import('@jsquash/png/decode.js')).default(input);
          } else if (info.mime === 'image/jpeg') {
            await codec('jpeg-dec', load); raster = await (await import('@jsquash/jpeg/decode.js')).default(input, { preserveOrientation: true });
          } else {
            await codec('webp-dec', load); raster = await (await import('@jsquash/webp/decode.js')).default(input);
          }
          checkSignal(request.signal);
          if (raster.width !== info.width || raster.height !== info.height)
            throw new JmError('INVALID_RESPONSE', 'Decoded dimensions differ from the image header');
          raster = resize(restoreRows(raster, slices), request.maxSide);
          checkSignal(request.signal);
          const png = request.format === 'png';
          await codec(png ? 'png' : 'jpeg-enc', load);
          const result = png ? await (await import('@jsquash/png/encode.js')).default(raster as ImageData)
            : await (await import('@jsquash/jpeg/encode.js')).default(raster as ImageData, { quality: request.quality ?? 90 });
          checkSignal(request.signal);
          return { data: new Uint8Array(result), mime: png ? 'image/png' : 'image/jpeg', width: raster.width, height: raster.height };
        } catch (cause) {
          if (cause instanceof JmError) throw cause;
          throw new JmError('INVALID_RESPONSE', 'Image decoding or encoding failed', false, undefined, { cause });
        }
      });
    },
  };
}
