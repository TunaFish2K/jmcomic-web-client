import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconDirectory = path.join(packageRoot, 'public', 'icons');
const source = path.join(iconDirectory, 'icon-v3.svg');

const outputs = [
  ['favicon-32-v3.png', 32],
  ['apple-touch-icon-180-v3.png', 180],
  ['icon-192-v3.png', 192],
  ['icon-512-v3.png', 512],
  ['icon-maskable-512-v3.png', 512],
  ['icon-1024-v3.png', 1024],
];

await Promise.all(outputs.map(async ([filename, size]) => {
  await sharp(source, { density: 192 })
    .resize(size, size, { kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9, palette: true, colours: 2 })
    .toFile(path.join(iconDirectory, filename));
}));

console.log(`Generated ${outputs.length} icon assets from public/icons/icon-v3.svg`);
