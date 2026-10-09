import { expect, test } from 'vitest';
import { runCaptureLanes } from './capture-lanes.js';
test('never overlaps jobs on a lane while using CPU and GPU concurrently', async () => {
  const active = new Set<string>();
  const finished: number[] = [];
  let overlap = false;
  await runCaptureLanes(
    [0, 1, 2, 3],
    (job) => (job % 2 ? ['cpu'] : ['gpu']),
    async (job, lane) => {
      expect(active.has(lane)).toBe(false);
      active.add(lane);
      if (active.size === 2) overlap = true;
      await new Promise((resolve) => setTimeout(resolve, 5));
      active.delete(lane);
      finished.push(job);
    },
  );
  expect(finished.toSorted()).toEqual([0, 1, 2, 3]);
  expect(overlap).toBe(true);
});
test('finishes in-flight work before rejecting a failed lane', async () => {
  let completed = false;
  await expect(
    runCaptureLanes(
      [0, 1],
      (job) => (job ? ['cpu'] : ['gpu']),
      async (job) => {
        if (job === 0) throw Error('failure');
        await new Promise((resolve) => setTimeout(resolve, 5));
        completed = true;
      },
    ),
  ).rejects.toThrow('failure');
  expect(completed).toBe(true);
});
