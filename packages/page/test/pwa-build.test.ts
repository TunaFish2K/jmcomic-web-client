import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

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

const distDirectory = fileURLToPath(new URL('../dist/', import.meta.url));

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

  it('keeps optional export code outside the install-critical precache', async () => {
    const serviceWorker = await readDistFile('sw.js');

    assert.match(serviceWorker, /skipWaiting\(\)/);
    assert.match(serviceWorker, /clientsClaim\(\)/);
    assert.match(serviceWorker, /createHandlerBoundToURL\("index\.html"\)/);
    assert.doesNotMatch(serviceWorker, /pdfkit\.standalone-/);

    const precachedUrls = [...serviceWorker.matchAll(/url:"([^"]+)"/g)].map((match) => match[1]);
    assert.ok(precachedUrls.includes('index.html'));
    for (const url of precachedUrls) {
      await access(path.join(distDirectory, url));
    }
  });

  it('keeps generated assets outside the poisoned legacy cache namespace', async () => {
    const html = await readDistFile('index.html');
    const generatedAssetUrls = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(
      (match) => match[1],
    );

    assert.ok(generatedAssetUrls.some((url) => url.endsWith('.js')));
    assert.ok(generatedAssetUrls.some((url) => url.endsWith('.css')));
    for (const url of generatedAssetUrls) {
      assert.match(url, /^\/assets-v2\//);
      await access(path.join(distDirectory, url.replace(/^\//, '')));
    }
  });

  it('emits restrictive headers for update-critical resources', async () => {
    const headers = await readDistFile('_headers');

    assert.match(headers, /\/sw\.js\s+Cache-Control: no-cache, no-store, must-revalidate/);
    assert.match(headers, /\/manifest\.webmanifest\s+Cache-Control: no-cache, no-store, must-revalidate/);
    assert.doesNotMatch(headers, /\/assets\/\*/);
    assert.doesNotMatch(headers, /immutable/);

    const routePatterns = headers.split('\n').filter((line) => line.startsWith('/'));
    for (const routePattern of routePatterns) {
      assert.ok((routePattern.match(/\*/g) ?? []).length <= 1, routePattern);
    }
  });
});
