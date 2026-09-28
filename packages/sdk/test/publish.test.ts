import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
// @ts-expect-error Release tooling is deliberately standalone JavaScript.
import { releaseDecision } from '../tools/publish-npm.mjs';

test('npm retry verifies identical bytes and never downgrades latest', () => {
  const bytes = Buffer.from('tested artifact');
  const manifest = { name: 'jmcomic-sdk-pwa', version: '0.2.21' };
  const dist = { integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` };
  assert.deepEqual(releaseDecision(manifest, bytes, null), { publish: true, promote: true });
  const metadata = { versions: { '0.2.21': { dist } }, 'dist-tags': { latest: '0.2.21' } };
  assert.deepEqual(releaseDecision(manifest, bytes, metadata), { publish: false, promote: false });
  metadata['dist-tags'].latest = '0.2.20';
  assert.deepEqual(releaseDecision(manifest, bytes, metadata), { publish: false, promote: true });
  metadata['dist-tags'].latest = '0.3.0';
  assert.deepEqual(releaseDecision(manifest, bytes, metadata), { publish: false, promote: false });
  assert.throws(() => releaseDecision(manifest, Buffer.from('different artifact'), metadata), /different bytes/);
  assert.throws(() => releaseDecision({ ...manifest, name: 'jmcomic-sdk' }, bytes, null), /Unexpected/);
  assert.throws(() => releaseDecision({ ...manifest, version: '0.2.21-branch' }, bytes, null), /Unexpected/);
});
