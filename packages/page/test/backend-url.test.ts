import assert from 'node:assert/strict';
import { test } from 'vitest';
import { getBackendUrl, resolveBackendUrl } from '../src/backend-url';

test('normalizes empty and production backend URLs and reads the Vite environment', () => {
  assert.equal(resolveBackendUrl({ rawUrl: undefined, development: false, hostname: 'host' }), '');
  assert.equal(resolveBackendUrl({ rawUrl: '   ', development: true, hostname: 'host' }), '');
  assert.equal(resolveBackendUrl({ rawUrl: ' https://api.test/path ', development: false, hostname: 'host' }), 'https://api.test/path');
  assert.equal(typeof getBackendUrl(), 'string');
});
