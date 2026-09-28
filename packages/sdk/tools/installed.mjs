import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';

export async function verifyInstalledPackage(temp, typescriptBinary) {
  await writeFile(join(temp, 'smoke.mjs'), `
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createImageProcessor} from 'jmcomic-sdk-pwa/image';
import {createNodeWasmLoader,createLocalClient} from 'jmcomic-sdk-pwa/node';
import {createRemoteClient,MemoryCache,JmError} from 'jmcomic-sdk-pwa';
import {createServer} from 'jmcomic-sdk-pwa/server';
import {createWorkersServer} from 'jmcomic-sdk-pwa/workers';
import {createUpstreamClient,discoverDomains} from 'jmcomic-sdk-pwa/upstream';
const result=await createImageProcessor({loadWasm:createNodeWasmLoader()}).process(new Uint8Array(await readFile('image.png')),10);
assert.equal(result.width,17);assert.equal(result.height,103);
for(const f of [createLocalClient,createRemoteClient,createServer,createWorkersServer,createUpstreamClient,discoverDomains,MemoryCache,JmError]) assert.equal(typeof f,'function');
console.log('Installed tarball: exports and real WASM image conversion passed');
`);
  execFileSync('node', ['smoke.mjs'], { cwd: temp, stdio: 'inherit' });
  await writeFile(join(temp, 'consumer.ts'), `
import {createLocalClient} from 'jmcomic-sdk-pwa/node';
import {createRemoteClient,JmError,MemoryCache} from 'jmcomic-sdk-pwa';
import type {JmClient,ImageResult} from 'jmcomic-sdk-pwa';
import {createImageProcessor} from 'jmcomic-sdk-pwa/image';
import {createServer} from 'jmcomic-sdk-pwa/server';
import {createUpstreamClient,type UpstreamClient} from 'jmcomic-sdk-pwa/upstream';
const upstream:UpstreamClient=createUpstreamClient(); upstream.dispose();
const local:JmClient=createLocalClient({cache:new MemoryCache()});
const remote:JmClient=createRemoteClient({baseUrl:'https://example.com'});
const server=createServer(local,{token:'token'});
const image:Promise<ImageResult>=remote.getImage('123',0,{format:'png'});
local.dispose();remote.dispose();void server;void image;void JmError;void createImageProcessor;
`);
  execFileSync(typescriptBinary, ['--noEmit', '--strict', '--module', 'NodeNext', '--target', 'ES2022', '--skipLibCheck', 'consumer.ts'], { cwd: temp, stdio: 'inherit' });
  const help = execFileSync('node', ['node_modules/jmcomic-sdk-pwa/dist/cli.js', '--help'], { cwd: temp, encoding: 'utf8' });
  assert.match(help, /JM_HOST/);
}
