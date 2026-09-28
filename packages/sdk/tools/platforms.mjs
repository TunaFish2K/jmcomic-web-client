import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
await build({ entryPoints: ['test/mock.ts'], outfile: '.artifacts/mock.mjs', platform: 'neutral', format: 'esm' });
const runtime = process.argv[2];
const commands = { node: ['node', ['tools/runtime.mjs']], bun: ['bun', ['tools/runtime.mjs']], deno: ['node_modules/.bin/deno', ['run', '--allow-read', '--allow-net', '--allow-env', 'tools/runtime.mjs']] };
for (const name of runtime ? [runtime] : Object.keys(commands)) {
  const command = commands[name]; if (!command) throw new Error(`Unknown runtime ${name}`);
  const result = spawnSync(command[0], command[1], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status) process.exit(result.status);
}
