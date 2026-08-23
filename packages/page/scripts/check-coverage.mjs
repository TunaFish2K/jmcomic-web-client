import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const summaryPath = resolve('coverage/coverage-summary.json');
const coverage = JSON.parse(await readFile(summaryPath, 'utf8'));
const standardFloor = { statements: 80, branches: 75, functions: 80, lines: 80 };
const readerFloor = { statements: 90, branches: 85, functions: 90, lines: 90 };
const failures = [];

for (const [absolutePath, metrics] of Object.entries(coverage)) {
  if (absolutePath === 'total') continue;
  const sourcePath = absolutePath.replace(/^.*[/\\]src[/\\]/u, 'src/').replaceAll('\\', '/');
  const floor = sourcePath.startsWith('src/reader/') ? readerFloor : standardFloor;
  for (const metric of Object.keys(floor)) {
    const percent = metrics[metric].pct;
    if (percent < floor[metric]) {
      failures.push(`${sourcePath}: ${metric} ${percent}% < ${floor[metric]}%`);
    }
  }
}

if (failures.length > 0) {
  console.error('\nPer-file coverage floors failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('Per-file coverage floors passed.');
}
