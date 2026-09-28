import { createImageProcessor } from 'jmcomic-sdk/image';
import type { ImageOptions } from 'jmcomic-sdk';
import jpegDec from 'jmcomic-sdk/wasm/mozjpeg_dec.wasm?url';
import jpegEnc from 'jmcomic-sdk/wasm/mozjpeg_enc.wasm?url';
import png from 'jmcomic-sdk/wasm/squoosh_png_bg.wasm?url';
import webpDec from 'jmcomic-sdk/wasm/webp_dec.wasm?url';

const assets = { 'jpeg-dec': jpegDec, 'jpeg-enc': jpegEnc, png, 'webp-dec': webpDec };
const processor = createImageProcessor({ loadWasm: async name => {
    const response = await fetch(assets[name]);
    if (!response.ok) throw new Error(`Image codec download failed: HTTP ${response.status}`);
    return WebAssembly.compile(await response.arrayBuffer());
} });
const context = globalThis as unknown as {
    onmessage: (event: MessageEvent<{ id: number; data: ArrayBuffer; slices: number; options: ImageOptions }>) => void;
    postMessage: (message: unknown, transfer?: Transferable[]) => void;
};
context.onmessage = async ({ data: job }) => {
    try {
        let result = await processor.process(new Uint8Array(job.data), job.slices, job.options);
        // Application exports require JPEG. The portable SDK intentionally passes GIF through.
        if (result.mime === 'image/gif' && job.options.format === 'jpeg') {
            const bitmap = await createImageBitmap(new Blob([result.data as Uint8Array<ArrayBuffer>]));
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            try {
                const drawing = canvas.getContext('2d');
                if (!drawing) throw new Error('Cannot create GIF conversion canvas');
                drawing.drawImage(bitmap, 0, 0);
                result = { ...result, mime: 'image/jpeg', data: new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: .9 })).arrayBuffer()) };
            } finally { bitmap.close(); canvas.width = 1; canvas.height = 1; }
        }
        context.postMessage({ id: job.id, result }, [result.data.buffer as ArrayBuffer]);
    } catch (error) {
        context.postMessage({ id: job.id, error: { code: (error as { code?: string }).code ?? 'INTERNAL', message: error instanceof Error ? error.message : 'Image processing failed' } });
    }
};
