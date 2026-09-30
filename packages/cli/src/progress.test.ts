import { expect, test } from 'vitest';
import { createProgress } from './progress.js';

test('rewrites one line at most once per second and estimates remaining time', () => {
  const writes: string[] = [];
  const stream = { isTTY: true, columns: 100, write: (value: string) => writes.push(value) };
  let time = 0;
  const progress = createProgress('process', false, stream, () => time);
  progress.update({ phase: 'Comparing', completed: 0, total: 4, unit: 'pairs' });
  time = 500;
  progress.update({ phase: 'Comparing', completed: 1, total: 5, unit: 'pairs' });
  expect(writes).toHaveLength(1);
  time = 1000;
  progress.update({ phase: 'Comparing', completed: 2, total: 6, unit: 'pairs' });
  expect(writes).toHaveLength(2);
  expect(writes[1]).toContain('2/6 pairs (4 remaining, ETA ~2s)');
  time = 1100;
  progress.update({ phase: 'Writing index', completed: 0, total: 1, unit: 'entries' });
  expect(writes).toHaveLength(2);
  progress.finish();
  expect(writes[2]).toBe('\r\x1b[2K');
  expect(writes.every((value) => !value.includes('\n'))).toBe(true);
});

test('quiet and redirected output have no progress line', () => {
  const writes: string[] = [];
  const stream = { isTTY: true, write: (value: string) => writes.push(value) };
  const status = { phase: 'Scanning', completed: 1, total: 2, unit: 'directories' };
  const quiet = createProgress('hash', true, stream);
  quiet.update(status);
  quiet.finish();
  stream.isTTY = false;
  const redirected = createProgress('hash', false, stream);
  redirected.update(status);
  redirected.finish();
  expect(writes).toEqual([]);
});
