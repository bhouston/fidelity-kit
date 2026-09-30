import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { analyzeCommits } from '@semantic-release/commit-analyzer';

// Published via pnpm publish directly (see release.config.js), so the package
// needs a real LICENSE and a `files` field that ships `dist`.
test('packages/cli is ready for pnpm publish', () => {
  assert.ok(existsSync(resolve('packages/cli/LICENSE')), 'packages/cli/LICENSE is missing');
  const pkg = JSON.parse(readFileSync(resolve('packages/cli/package.json'), 'utf8'));
  assert.ok(pkg.files?.includes('dist'), 'packages/cli/package.json files must include "dist"');
});

const logger = { log() {} };
for (const [message, expected] of [
  ['feat: add batch conversion', 'minor'],
  ['fix(cli): handle empty input', 'patch'],
  ['perf: reduce allocations', 'patch'],
  ['docs: clarify usage', null],
  ['chore: update tooling', null],
  ['feat!: remove legacy reader', 'major'],
  ['fix: change format\n\nBREAKING CHANGE: old files are unsupported', 'major'],
]) {
  test(`release analysis: ${message.split('\n')[0]}`, async () => {
    assert.equal(
      await analyzeCommits(
        { preset: 'conventionalcommits' },
        { cwd: process.cwd(), commits: [{ hash: 'abc', message }], logger },
      ),
      expected,
    );
  });
}
