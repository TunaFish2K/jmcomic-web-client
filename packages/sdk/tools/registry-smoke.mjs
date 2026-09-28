import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyInstalledPackage } from './installed.mjs';

const folder = resolve(process.argv[2] ?? 'release');
const files = (await readdir(folder)).filter(name => name.endsWith('.tgz'));
assert.equal(files.length, 1);
const tarball = resolve(folder, files[0]);
const manifest = JSON.parse(execFileSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' }));
assert.equal(manifest.name, 'jmcomic-sdk-pwa');
const expected = `sha512-${createHash('sha512').update(await readFile(tarball)).digest('base64')}`;
let metadata;
for (let attempt = 0; attempt < 5; attempt++) {
  const response = await fetch(`https://registry.npmjs.org/${manifest.name}/${manifest.version}`, { signal: AbortSignal.timeout(30000) });
  if (response.ok) { metadata = await response.json(); break; }
  if (response.status !== 404) throw new Error(`Registry verification failed: HTTP ${response.status}`);
  if (attempt < 4) await delay(3000);
}
assert.ok(metadata, 'Published version did not appear in the registry');
assert.equal(metadata.dist.integrity, expected, 'npm and GitHub artifact integrity differ');
const temp = await mkdtemp(join(tmpdir(), 'jm-sdk-registry-'));
try {
  await writeFile(join(temp, 'package.json'), JSON.stringify({ name: 'registry-consumer', private: true, type: 'module' }));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'npm_config_allow_scripts') delete env[key];
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/', `${manifest.name}@${manifest.version}`, 'typescript@5.9.3'], { cwd: temp, env, stdio: 'pipe' });
  await cp(new URL('../test/fixtures/17x103-10.png', import.meta.url), join(temp, 'image.png'));
  await verifyInstalledPackage(temp, join(temp, 'node_modules/.bin/tsc'));
  const version = execFileSync(join(temp, 'node_modules/.bin/jmcomic-sdk-pwa'), ['--version'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(version.trim(), manifest.version);
  console.log(`Registry installation verified: ${manifest.name}@${manifest.version}, identical artifact, types, CLI and WASM`);
} finally { await rm(temp, { recursive: true, force: true }); }
