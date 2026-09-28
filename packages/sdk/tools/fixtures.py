"""Create synthetic fixtures without the SDK restoration implementation."""
from pathlib import Path
import hashlib
import json
from PIL import Image

root = Path(__file__).resolve().parents[1] / 'test' / 'fixtures'
root.mkdir(exist_ok=True)
manifest = []
for width, height, slices in [(17, 103, 10), (31, 1016, 16), (9, 8197, 18), (720, 1016, 2)]:
    upright = Image.new('RGBA', (width, height))
    pixels = [(x * 7 % 256, y % 256, (y // 256) % 256, 255)
              for y in range(height) for x in range(width)]
    upright.putdata(pixels)
    # Cut the upright reference top-to-bottom; the first strip owns the remainder.
    # The encoded upstream image stores those strips in reverse order.
    sizes = [height // slices] * slices
    sizes[0] += height % slices
    strips, at = [], 0
    for size in sizes:
        strips.append(upright.crop((0, at, width, at + size)))
        at += size
    scrambled = Image.new('RGBA', upright.size)
    at = 0
    for strip in reversed(strips):
        scrambled.paste(strip, (0, at))
        at += strip.height
    stem = f'{width}x{height}-{slices}'
    upright.save(root / f'{stem}-upright.png')
    for fmt in ('png', 'webp', 'jpg'):
        image = scrambled.convert('RGB') if fmt == 'jpg' else scrambled
        kwargs = {'lossless': True} if fmt == 'webp' else {'quality': 100, 'subsampling': 0} if fmt == 'jpg' else {}
        image.save(root / f'{stem}.{fmt}', **kwargs)
    manifest.append({'stem': stem, 'width': width, 'height': height, 'slices': slices,
                     'rgbaSha256': hashlib.sha256(upright.tobytes()).hexdigest()})
(root / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
