import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const registry = 'https://registry.npmjs.org/';
export function releaseDecision(manifest, bytes, metadata) {
  if (manifest.name !== 'jmcomic-sdk-pwa' || !/^0\.2\.\d+$/.test(manifest.version))
    throw new Error('Unexpected SDK package name or version');
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  const existing = metadata?.versions?.[manifest.version];
  if (existing && existing.dist?.integrity !== integrity)
    throw new Error('The registry version exists with different bytes; refusing to overwrite or skip');
  const latest = metadata?.['dist-tags']?.latest;
  const compare = version => version.split('.').map(Number);
  let promote = !latest;
  if (latest) {
    if (!/^\d+\.\d+\.\d+$/.test(latest)) throw new Error('Unexpected latest version; refusing automatic promotion');
    const a = compare(manifest.version), b = compare(latest);
    promote = a[0] > b[0] || a[0] === b[0] && (a[1] > b[1] || a[1] === b[1] && a[2] > b[2]);
  }
  return { publish: !existing, promote };
}

async function main() {
  const folder = resolve(process.argv[2] ?? 'release');
  const files = (await readdir(folder)).filter(name => name.endsWith('.tgz'));
  if (files.length !== 1) throw new Error('Expected exactly one tested SDK tarball');
  const tarball = resolve(folder, files[0]);
  const manifest = JSON.parse(execFileSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' }));
  const response = await fetch(`${registry}jmcomic-sdk-pwa`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok && response.status !== 404) throw new Error(`Registry lookup failed: HTTP ${response.status}`);
  const metadata = response.status === 404 ? null : await response.json();
  if (metadata && (!metadata.versions || !metadata['dist-tags'])) throw new Error('Malformed registry metadata');
  const decision = releaseDecision(manifest, await readFile(tarball), metadata);
  const npm = args => execFileSync('npm', [...args, '--registry', registry], { stdio: 'inherit' });
  // OIDC authenticates publish; select the tag in that operation, without dist-tag writes.
  const tag = decision.promote ? 'latest' : `build-${manifest.version.replaceAll('.', '-')}`;
  if (decision.publish) npm(['publish', tarball, '--access', 'public', '--ignore-scripts', '--tag', tag]);
  const message = `${manifest.name}@${manifest.version}: ${decision.publish ? 'published tested tarball' : 'existing tarball integrity matched'}; ${decision.publish ? `tag=${tag}` : 'latest unchanged'}.`;
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
