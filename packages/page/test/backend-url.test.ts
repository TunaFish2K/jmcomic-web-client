import assert from 'node:assert/strict';
import { test } from 'vitest';
import { ensureBackendPreconnect, getBackendUrl, resolveBackendUrl } from '../src/backend-url';

test('normalizes empty and production backend URLs and reads the Vite environment', () => {
  assert.equal(resolveBackendUrl({ rawUrl: undefined, development: false, hostname: 'host' }), '');
  assert.equal(resolveBackendUrl({ rawUrl: '   ', development: true, hostname: 'host' }), '');
  assert.equal(resolveBackendUrl({ rawUrl: ' https://api.test/path ', development: false, hostname: 'host' }), 'https://api.test/path');
  assert.equal(typeof getBackendUrl(), 'string');
});

test('adds one DNS hint and preconnect for the backend origin', () => {
  document.head.innerHTML = '';
  ensureBackendPreconnect('https://api.test/path');
  ensureBackendPreconnect('https://api.test/another');
  assert.equal(document.head.querySelectorAll('link[rel="dns-prefetch"]').length, 1);
  const preconnect = document.head.querySelector<HTMLLinkElement>('link[rel="preconnect"]');
  assert.equal(preconnect?.href, 'https://api.test/');
  assert.equal(preconnect?.crossOrigin, 'anonymous');
  ensureBackendPreconnect('http://[');
  ensureBackendPreconnect('');
});
