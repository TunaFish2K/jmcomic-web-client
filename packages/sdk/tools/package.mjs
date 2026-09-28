import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

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
  await writeFile(join(temp, 'smoke.mjs'), `
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createImageProcessor} from 'jmcomic-sdk/image';
import {createNodeWasmLoader,createLocalClient} from 'jmcomic-sdk/node';
import {createRemoteClient,MemoryCache,JmError} from 'jmcomic-sdk';
import {createServer} from 'jmcomic-sdk/server';
import {createWorkersServer} from 'jmcomic-sdk/workers';
import {createUpstreamClient,discoverDomains} from 'jmcomic-sdk/upstream';
const result=await createImageProcessor({loadWasm:createNodeWasmLoader()}).process(new Uint8Array(await readFile('image.png')),10);
assert.equal(result.width,17);assert.equal(result.height,103);
for(const f of [createLocalClient,createRemoteClient,createServer,createWorkersServer,createUpstreamClient,discoverDomains,MemoryCache,JmError]) assert.equal(typeof f,'function');
console.log('Installed tarball: exports and real WASM image conversion passed');
`);
  execFileSync('node', ['smoke.mjs'], { cwd: temp, stdio: 'inherit' });
  await writeFile(join(temp, 'consumer.ts'), `
import {createLocalClient} from 'jmcomic-sdk/node';
import {createRemoteClient,JmError,MemoryCache} from 'jmcomic-sdk';
import type {JmClient,ImageResult} from 'jmcomic-sdk';
import {createImageProcessor} from 'jmcomic-sdk/image';
import {createServer} from 'jmcomic-sdk/server';
import {createUpstreamClient,type UpstreamClient} from 'jmcomic-sdk/upstream';
const upstream:UpstreamClient=createUpstreamClient(); upstream.dispose();
const local:JmClient=createLocalClient({cache:new MemoryCache()});
const remote:JmClient=createRemoteClient({baseUrl:'https://example.com'});
const server=createServer(local,{token:'token'});
const image:Promise<ImageResult>=remote.getImage('123',0,{format:'png'});
local.dispose();remote.dispose();void server;void image;void JmError;void createImageProcessor;
`);
  execFileSync(resolve('node_modules/.bin/tsc'), ['--noEmit', '--strict', '--module', 'NodeNext', '--target', 'ES2022', '--skipLibCheck', 'consumer.ts'], { cwd: temp, stdio: 'inherit' });
  const help = execFileSync('node', ['node_modules/jmcomic-sdk/dist/cli.js', '--help'], { cwd: temp, encoding: 'utf8' });
  assert.match(help, /JM_HOST/);
  console.log(`Installed tarball: TypeScript consumer and CLI passed; ${packed.size} compressed bytes`);
} finally { await rm(temp, { recursive: true, force: true }); }
