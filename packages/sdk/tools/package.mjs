import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { verifyInstalledPackage } from './installed.mjs';
import { build } from 'esbuild';

const packedOutput = JSON.parse(execFileSync('npm', ['pack', '--json'], { encoding: 'utf8' }));
const packed = Array.isArray(packedOutput) ? packedOutput[0] : Object.values(packedOutput)[0];
const tarball = resolve(packed.filename);
const temp = await mkdtemp(join(tmpdir(), 'jm-sdk-consumer-'));
// npm 12 exports the user's allow-scripts setting into `npm run` children,
// then rejects that same environment option during a project-scoped install.
const installEnv = { ...process.env };
for (const key of Object.keys(installEnv)) if (key.toLowerCase() === 'npm_config_allow_scripts') delete installEnv[key];
try {
  await writeFile(join(temp, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module' }));
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], { cwd: temp, env: installEnv, stdio: 'pipe' });
  await cp('test/fixtures/17x103-10.png', join(temp, 'image.png'));
  await build({ entryPoints: ['test/mock.ts'], outfile: join(temp, 'mock.mjs'), bundle: true, platform: 'node', format: 'esm' });
  await cp('tools/consumer.mjs', join(temp, 'consumer.mjs'));
  execFileSync('node', ['consumer.mjs'], { cwd: temp, stdio: 'inherit', timeout: 60000 });
  await verifyInstalledPackage(temp, resolve('node_modules/.bin/tsc'));
  console.log(`Installed tarball: TypeScript consumer and CLI passed; ${packed.size} compressed bytes`);
} finally { await rm(temp, { recursive: true, force: true }); }
