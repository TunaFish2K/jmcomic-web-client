import { expect, test } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';

// Resolve from the package cwd so the same test checks the actual production build.
async function workerUrl() {
    const files = await readdir('dist/assets-v3');
    const filename = files.find(name => /^image-worker-.*\.js$/.test(name));
    if (!filename) throw new Error('Production image worker is missing');
    return `/assets-v3/${filename}`;
}

test('production image worker restores real PNG/WebP/JPEG and keeps the UI responsive', async ({ page }) => {
    const fixtures: Record<string, number[]> = {};
    for (const format of ['png', 'webp', 'jpg']) fixtures[format] = [...await readFile(`../sdk/test/fixtures/720x1016-2.${format}`)];
    await page.goto('/pwa-cache-cleanup-v3.txt');
    const result = await page.evaluate(async ({ url, fixtures }) => {
        const worker = new Worker(url, { type: 'module' });
        let ticks = 0;
        const timer = setInterval(() => ticks++, 1);
        let sequence = 0;
        const run = (bytes: number[], format: 'jpeg' | 'png') => new Promise<{ data: Uint8Array; width: number; height: number; mime: string }>((resolve, reject) => {
            const id = sequence++;
            worker.onmessage = ({ data }) => {
                if (data.id !== id) return;
                if (data.error) reject(new Error(data.error.message)); else resolve(data.result);
            };
            worker.onerror = event => reject(new Error(event.message));
            const data = Uint8Array.from(bytes).buffer;
            worker.postMessage({ id, data, slices: 2, options: { format } }, [data]);
        });
        try {
            const png = await run(fixtures.png, 'png');
            const webp = await run(fixtures.webp, 'png');
            const jpeg = await run(fixtures.jpg, 'jpeg');
            const bitmap = await createImageBitmap(new Blob([png.data as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
            const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
            const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0); bitmap.close();
            const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
            let mismatch = 0;
            for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
                const i = (y * canvas.width + x) * 4;
                if (rgba[i] !== x * 7 % 256 || rgba[i + 1] !== y % 256 || rgba[i + 2] !== Math.floor(y / 256) % 256 || rgba[i + 3] !== 255) mismatch++;
            }
            return { mismatch, same: png.data.length === webp.data.length && png.data.every((v, i) => v === webp.data[i]), dimensions: [jpeg.width, jpeg.height], ticks };
        } finally { clearInterval(timer); worker.terminate(); }
    }, { url: await workerUrl(), fixtures });
    expect(result.mismatch).toBe(0); expect(result.same).toBe(true);
    expect(result.dimensions).toEqual([720, 1016]); expect(result.ticks).toBeGreaterThan(0);
});
