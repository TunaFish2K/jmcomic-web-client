import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error Release tooling is standalone JavaScript.
import { waitForRegistryVersion } from '../tools/registry.mjs';

test('registry verification waits for processing and returns immediately when installable', async () => {
  let calls = 0, time = 0, pauses = 0;
  const published = { name: 'jmcomic-sdk-pwa', version: '0.2.22', dist: { integrity: 'expected' } };
  const options = {
    fetch: async () => {
      calls++;
      if (calls === 1) return new Response('', { status: 404 });
      return Response.json({ versions: calls < 4 ? {} : { '0.2.22': published } });
    },
    now: () => time, pause: async (ms: number) => { time += ms; pauses++; }, log: () => {},
  };
  assert.deepEqual(await waitForRegistryVersion('jmcomic-sdk-pwa', '0.2.22', options), published);
  assert.equal(time, 30000); assert.equal(pauses, 3);
  await waitForRegistryVersion('jmcomic-sdk-pwa', '0.2.22', options);
  assert.equal(pauses, 3, 'an available version must not add a fixed wait');
});

test('registry verification has a deadline and does not hide authentication or malformed responses', async () => {
  let time = 0;
  const options = { now: () => time, pause: async (ms: number) => { time += ms; }, log: () => {}, timeoutMs: 20000 };
  await assert.rejects(waitForRegistryVersion('pkg', '0.2.22', { ...options, fetch: async () => Response.json({ versions: {} }) }), /still unavailable after 20s/);
  assert.equal(time, 20000);
  for (const status of [401, 403, 503]) {
    await assert.rejects(waitForRegistryVersion('pkg', '0.2.22', { ...options, fetch: async () => new Response('', { status }) }), new RegExp(`HTTP ${status}`));
  }
  await assert.rejects(waitForRegistryVersion('pkg', '0.2.22', { ...options, fetch: async () => Response.json({}) }), /Malformed/);
});
