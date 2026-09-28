import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import decode from '@jsquash/png/decode.js';
import { createImageProcessor } from '../dist/image.js';
import { createNodeWasmLoader } from '../dist/adapters/node.js';
const manifest = JSON.parse(await readFile(new URL('./fixtures/manifest.json', import.meta.url), 'utf8'));
const processor = createImageProcessor({ loadWasm: createNodeWasmLoader() });
for (const fixture of manifest) {
  for (const format of ['png', 'webp', 'jpg']) test(`real WASM restores ${fixture.stem}.${format}`, async () => {
    const source = new Uint8Array(await readFile(new URL(`./fixtures/${fixture.stem}.${format}`, import.meta.url)));
    const upright = new Uint8Array(await readFile(new URL(`./fixtures/${fixture.stem}-upright.png`, import.meta.url)));
    const result = await processor.process(source, fixture.slices, { format: 'png' });
    assert.equal(result.width, fixture.width); assert.equal(result.height, fixture.height);
    const rgba = await decode(result.data.slice().buffer);
    if (format !== 'jpg') assert.equal(createHash('sha256').update(rgba.data).digest('hex'), fixture.rgbaSha256);
    else {
      let maxError = 0;
      for (let y = 0; y < fixture.height; y++) for (let x = 0; x < fixture.width; x++) {
        const expected = [x * 7 % 256, y % 256, Math.floor(y / 256) % 256, 255];
        for (let c = 0; c < 4; c++) maxError = Math.max(maxError, Math.abs(rgba.data[(y * fixture.width + x) * 4 + c]! - expected[c]!));
      }
      assert.ok(maxError <= 4, `JPEG max channel error ${maxError}`);
    }
    if (format !== 'jpg') for (const maxSide of [71, 513]) {
      const expected = await processor.process(upright, 0, { maxSide });
      const actual = await processor.process(source, fixture.slices, { maxSide });
      assert.deepEqual(actual, expected, `restoration before global scaling at ${maxSide}`);
    }
  });
}
