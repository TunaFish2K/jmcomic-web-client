// @vitest-environment node
import assert from 'node:assert/strict';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'vitest';
import { gunzipSync } from 'node:zlib';
import {
  ORT_MJS_ASSET_PATH,
  ORT_WASM_GZIP_ASSET_PATH,
} from '../src/translation/ort-assets';

interface WebAppManifest {
  id?: string;
  name?: string;
  short_name?: string;
  lang?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  prefer_related_applications?: boolean;
  icons?: Array<{
    src: string;
    sizes?: string;
    purpose?: string;
  }>;
}

interface ReleaseMetadata {
  commit?: string;
  branch?: string;
}

const distDirectory = fileURLToPath(new URL('../dist/', import.meta.url));
const cloudflarePagesFileLimit = 25 * 1024 * 1024;
const require = createRequire(import.meta.url);

async function readDistFile(filename: string) {
  return readFile(path.join(distDirectory, filename), 'utf8');
}

describe('PWA build output', () => {
  it('emits a stable, installable web app manifest', async () => {
    const manifest = JSON.parse(await readDistFile('manifest.webmanifest')) as WebAppManifest;

    assert.equal(manifest.id, '/');
    assert.equal(manifest.name, 'J Client');
    assert.equal(manifest.short_name, 'J');
    assert.equal(manifest.lang, 'zh-CN');
    assert.equal(manifest.start_url, '/');
    assert.equal(manifest.scope, '/');
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.prefer_related_applications, false);

    const icons = manifest.icons ?? [];
    assert.ok(icons.some((icon) => icon.sizes === '192x192' && icon.purpose === 'any'));
    assert.ok(icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'any'));
    assert.ok(icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'maskable'));
    for (const icon of icons) {
      await access(path.join(distDirectory, icon.src.replace(/^\//, '')));
    }
  });

  it('uses a self-contained worker only to remove legacy app-shell caches', async () => {
    const serviceWorker = await readDistFile('sw.js');

    assert.match(serviceWorker, /skipWaiting\(\)/);
    assert.match(serviceWorker, /clients\.claim\(\)/);
    assert.doesNotMatch(serviceWorker, /importScripts\(/);
    assert.doesNotMatch(serviceWorker, /assets-v[23]\//);
    assert.doesNotMatch(serviceWorker, /pdfkit\.standalone-/);
    assert.doesNotMatch(serviceWorker, /cover-images/);
    assert.doesNotMatch(serviceWorker, /\/(?:search|album|photo|batch-album)/);
    assert.doesNotMatch(serviceWorker, /createHandlerBoundToURL\("index\.html"\)/);

    const precachedUrls = [...serviceWorker.matchAll(/url:"([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(precachedUrls, ['pwa-cache-cleanup-v3.txt']);
    for (const url of precachedUrls) {
      await access(path.join(distDirectory, url));
    }

    const emittedFiles = await readdir(distDirectory, { recursive: true });
    assert.ok(!emittedFiles.some((file) => file.includes('workbox-window')));
    assert.ok(!emittedFiles.some((file) => /^workbox-.*\.js$/.test(file)));
  });

  it('emits uncached release metadata without adding it to the worker cache', async () => {
    const release = JSON.parse(await readDistFile('release.json')) as ReleaseMetadata;
    const serviceWorker = await readDistFile('sw.js');

    assert.equal(typeof release.commit, 'string');
    assert.ok(release.commit);
    assert.equal(typeof release.branch, 'string');
    assert.ok(release.branch);
    assert.doesNotMatch(serviceWorker, /release\.json/);
  });

  it('keeps generated assets outside the legacy cache namespace', async () => {
    const html = await readDistFile('index.html');
    const generatedAssetUrls = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(
      (match) => match[1],
    );

    assert.ok(generatedAssetUrls.some((url) => url.endsWith('.js')));
    assert.ok(generatedAssetUrls.some((url) => url.endsWith('.css')));
    for (const url of generatedAssetUrls) {
      assert.match(url, /^\/assets-v3\//);
      await access(path.join(distDirectory, url.replace(/^\//, '')));
    }
  });

  it('keeps every deploy asset within the Cloudflare Pages file limit', async () => {
    const emittedFiles = await readdir(distDirectory, { recursive: true });
    for (const filename of emittedFiles) {
      const info = await stat(path.join(distDirectory, filename));
      if (!info.isFile()) continue;
      assert.ok(
        info.size <= cloudflarePagesFileLimit,
        `${filename} is ${(info.size / 1024 / 1024).toFixed(1)} MiB`,
      );
    }
  });

  it('emits a browser-decompressible ORT runtime without the oversized WASM', async () => {
    const compressed = await readFile(
      path.join(distDirectory, ORT_WASM_GZIP_ASSET_PATH.replace(/^\//, '')),
    );
    const source = await readFile(
      require.resolve('onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm'),
    );
    const emittedFiles = await readdir(distDirectory, { recursive: true });

    assert.deepEqual(gunzipSync(compressed), source);
    assert.ok(compressed.length < cloudflarePagesFileLimit);
    await access(path.join(distDirectory, ORT_MJS_ASSET_PATH.replace(/^\//, '')));
    assert.equal(
      emittedFiles.some((file) =>
        /ort-wasm-simd-threaded\.jsep(?:-[^/]+)?\.wasm$/.test(file),
      ),
      false,
    );
  });

  it('emits restrictive headers for update-critical resources', async () => {
    const headers = await readDistFile('_headers');

    assert.match(headers, /\/sw\.js\s+Cache-Control: no-cache, no-store, must-revalidate/);
    assert.match(headers, /\/manifest\.webmanifest\s+Cache-Control: no-cache, no-store, must-revalidate/);
    assert.match(headers, /\/release\.json\s+Cache-Control: no-cache, no-store, must-revalidate/);
    assert.match(headers, /^\/\s+Cache-Control: no-cache, no-store, must-revalidate/m);
    assert.match(headers, /\/reader\/\*\s+Cache-Control: no-cache, no-store, must-revalidate/);
    assert.match(headers, /\/assets-v3\/\*\s+Cache-Control: public, max-age=0, must-revalidate/);
    assert.doesNotMatch(headers, /\/assets\/\*/);
    assert.doesNotMatch(headers, /immutable/);

    const routePatterns = headers.split('\n').filter((line) => line.startsWith('/'));
    for (const routePattern of routePatterns) {
      assert.ok((routePattern.match(/\*/g) ?? []).length <= 1, routePattern);
    }
  });
});
