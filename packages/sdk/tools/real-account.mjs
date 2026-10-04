// Real-account acceptance check for jmcomic-sdk-pwa/mobile. Local only: CI never runs it.
// Credentials come from .env.test.local at the repository root (git-ignored by `*.local`).
// Output never contains the username, password, JWT or cookies.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { createMobileClient } from '../dist/mobile.js';

const envFile = fileURLToPath(new URL('../../../.env.test.local', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
const { JM_TEST_USER: user, JM_TEST_PASS: pass, JM_TEST_ALBUM_ID: albumId = '350234', JM_TEST_WRITE, JM_TEST_PROXY } = process.env;
// Writes stay private to the test account: only a favorite toggle that is restored. Public comments are never posted.
if (!user || !pass) {
  console.error('Set JM_TEST_USER and JM_TEST_PASS in .env.test.local at the repository root.');
  process.exit(2);
}
if (!/^\d{1,16}$/.test(albumId)) {
  console.error('JM_TEST_ALBUM_ID must be a numeric album ID.');
  process.exit(2);
}
const writes = JM_TEST_WRITE === '1';
const agent = JM_TEST_PROXY ? new ProxyAgent(`http://${JM_TEST_PROXY}`) : undefined;
const client = createMobileClient({
  retries: 1,
  fetch: agent ? (input, init) => undiciFetch(input, { ...init, dispatcher: agent }) : undefined,
});

const secrets = [user, pass];
const redact = text => secrets.filter(Boolean).reduce((value, secret) => value.split(secret).join('***'), String(text));
const results = [];
let failed = false;
async function step(name, run) {
  const started = Date.now();
  try {
    const detail = await run();
    results.push({ step: name, ok: true, ms: Date.now() - started, ...(detail ? { detail } : {}) });
    console.log(`PASS ${name}${detail ? ` — ${redact(detail)}` : ''}`);
    return true;
  } catch (error) {
    failed = true;
    const message = redact(`${error?.code ?? 'ERROR'}: ${error?.message ?? error}`);
    results.push({ step: name, ok: false, ms: Date.now() - started, error: message });
    console.log(`FAIL ${name} — ${message}`);
    return false;
  }
}

try {
  const loggedIn = await step('login', async () => {
    const { account } = await client.login(user, pass);
    secrets.push(account.jwt, account.avs, account.uid);
    return 'session received';
  });
  if (loggedIn) {
    await step('profile', async () => `${Object.keys(await client.profile()).length} fields`);
    await step('daily status', async () => {
      const daily = await client.daily();
      return `dailyId ${daily.dailyId ? 'present' : 'missing'}, ${daily.record.flat().length} days`;
    });
    await step('favorites', async () => {
      const favorites = await client.favorites({ page: 1 });
      return `total ${favorites.total}, ${favorites.folders.length} folders`;
    });
    await step('cloud history', async () => `total ${(await client.history(1)).total}`);
    await step('comments (public)', async () => `total ${(await client.comments({ albumId, page: 1 })).total}`);

    if (writes) {
      await step('favorite toggle and restore', async () => {
        const first = await client.toggleFavorite(albumId);
        if (!first.ok) throw new Error(`toggle refused: ${first.message}`);
        const listed = (await client.favorites({ page: 1 })).items.some(item => item.id === albumId);
        const second = await client.toggleFavorite(albumId);
        if (!second.ok) throw new Error(`restore refused: ${second.message} — check album ${albumId} in favorites manually`);
        if (first.data.type === 'add' && !listed) throw new Error('added favorite did not appear in the list (state restored)');
        return `first ${first.data.type ?? 'unknown'}, restored with ${second.data.type ?? 'unknown'}`;
      });
    } else {
      console.log('SKIP writes — set JM_TEST_WRITE=1 to toggle a favorite and restore it.');
    }
    await step('logout', async () => (await client.logout()).ok ? 'ok' : 'refused by upstream');
  }
} finally {
  client.dispose();
  await agent?.close();
}
console.log(JSON.stringify({ timestamp: new Date().toISOString(), albumId, writes, results }, null, 2));
process.exit(failed ? 1 : 0);
