import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import sharp from 'sharp';

const iconDirectory = fileURLToPath(new URL('../public/icons/', import.meta.url));
const expectedSizes = new Map([
  ['favicon-32-v3.png', 32],
  ['apple-touch-icon-180-v3.png', 180],
  ['icon-192-v3.png', 192],
  ['icon-512-v3.png', 512],
  ['icon-maskable-512-v3.png', 512],
  ['icon-1024-v3.png', 1024],
]);

async function readPixel(filename: string, x: number, y: number) {
  const { data, info } = await sharp(path.join(iconDirectory, filename))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * info.channels;
  return [...data.subarray(offset, offset + 3)];
}

describe('generated icon assets', () => {
  it('contains every required opaque PNG at the declared size', async () => {
    for (const [filename, size] of expectedSizes) {
      const metadata = await sharp(path.join(iconDirectory, filename)).metadata();
      assert.equal(metadata.format, 'png', filename);
      assert.equal(metadata.width, size, filename);
      assert.equal(metadata.height, size, filename);
      assert.equal(metadata.hasAlpha, false, filename);
    }
  });

  it('renders a black background and white geometric mark', async () => {
    assert.deepEqual(await readPixel('icon-1024-v3.png', 0, 0), [0, 0, 0]);
    assert.deepEqual(await readPixel('icon-1024-v3.png', 400, 250), [255, 255, 255]);
    assert.deepEqual(await readPixel('icon-1024-v3.png', 512, 512), [0, 0, 0]);
  });

  it('keeps every outer mark corner inside the maskable safe circle', () => {
    const outerCorners = [
      [352, 224],
      [768, 224],
      [768, 800],
      [256, 800],
      [256, 544],
    ];
    const safeRadius = 1024 * 0.4;
    for (const [x, y] of outerCorners) {
      assert.ok(Math.hypot(x - 512, y - 512) <= safeRadius, `${x},${y} is outside the safe zone`);
    }
  });
});
