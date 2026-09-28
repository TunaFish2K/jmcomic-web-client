import { setTimeout as delay } from 'node:timers/promises';

// npm may acknowledge publication before its processing queue makes it installable.
export async function waitForRegistryVersion(name, version, {
  fetch: transport = globalThis.fetch, timeoutMs = 600000,
  now = Date.now, pause = delay, log = console.log,
} = {}) {
  const deadline = now() + timeoutMs;
  for (;;) {
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error(`npm accepted the upload, but ${name}@${version} is still unavailable after ${timeoutMs / 1000}s; retry this job after npm processing finishes`);
    // Query the same abbreviated metadata npm install uses, bypassing stale caches.
    const response = await transport(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
      headers: { accept: 'application/vnd.npm.install-v1+json', 'cache-control': 'no-cache' },
      signal: AbortSignal.timeout(Math.min(30000, remaining)),
    });
    if (response.ok) {
      const metadata = await response.json();
      if (!metadata.versions || typeof metadata.versions !== 'object') throw new Error('Malformed npm registry metadata');
      if (Object.hasOwn(metadata.versions, version)) return metadata.versions[version];
    } else if (response.status !== 404) throw new Error(`Registry verification failed: HTTP ${response.status}`);
    log(`Waiting for npm processing: ${name}@${version} is not installable yet`);
    await pause(Math.max(0, Math.min(10000, deadline - now())));
  }
}
