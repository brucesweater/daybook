// `npm test`: the unit tests and the browser tests, each under three time zones, then fresh screenshots of every
// size, mode and state in test/artifacts/ (a passing test doesn't prove it's beautiful).

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ZONES = ['America/Chicago', 'America/Los_Angeles', 'Asia/Tokyo'];

const runs = [
  ...ZONES.map((zone) => ({ name: `unit, ${zone}`, args: ['--test', 'test/unit/*.test.mjs'], env: { TZ: zone } })),
  ...ZONES.map((zone) => ({
    name: `e2e, ${zone}`,
    args: ['--test', '--test-concurrency=2', 'test/e2e/*.test.mjs'],
    env: { DAYBOOK_TZ: zone },
  })),
  { name: 'screenshots', args: ['test/screenshots.mjs'], env: {} },
];

let failed = false;
const summary = [];
for (const { name, args, env } of runs) {
  console.log(`\n=== ${name} ===`);
  const started = Date.now();
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const output = result.stdout ?? '';
  const failures = output.split('\n').filter((line) => /^\s*✖/.test(line));
  const counts = output.split('\n').filter((line) => /^ℹ (tests|pass|fail) |^\d+ screenshots/.test(line)).map((line) => line.replace(/^ℹ /, '')).join(', ');
  if (result.status !== 0) {
    failed = true;
    console.log(output.slice(output.indexOf('✖ failing tests') >= 0 ? output.indexOf('✖ failing tests') : 0));
  } else {
    console.log(counts);
  }
  summary.push(`${result.status === 0 ? 'ok  ' : 'FAIL'}  ${name}: ${counts} (${Math.round((Date.now() - started) / 1000)} s)${failures.length ? `, ${failures.length} failure lines` : ''}`);
}

console.log(`\n${summary.join('\n')}`);
process.exit(failed ? 1 : 0);
