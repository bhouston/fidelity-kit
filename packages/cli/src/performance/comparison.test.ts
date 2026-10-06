import { it, expect } from 'vitest';
import { processRun, type ProcessedResult } from '../schema/index.js';
import { compareGroups, selectComparisonGroup } from './comparison.js';
function run(id: string, scene: string, renderer: string, interval: number): ProcessedResult {
  return processRun({
    schemaVersion: 1,
    runId: id,
    entry: {
      id,
      name: id,
      url: 'https://example.com',
      renderer: { id: renderer, name: renderer },
      scene: { id: scene, name: scene },
    },
    networkProfile: { name: 'unthrottled', latencyMs: 0, downloadBytesPerSec: -1, uploadBytesPerSec: -1 },
    config: { durationMs: 100, vsync: 'on' },
    harness: { teardown: 1200 },
    reporter: {
      runStart: 1000,
      runEnd: 1200,
      frames: Array.from({ length: 5 }, (_, index) => ({
        cpuStart: 1000 + index * interval,
        cpuEnd: 1001 + index * interval,
      })),
    },
    status: 'ok',
  });
}
it('pairs directories by stable entry id without pooling scenes', () => {
  const a = [run('cube', 'cube', 'a', 10), run('sponza', 'sponza', 'a', 30)],
    b = [run('cube', 'cube', 'b', 20), run('sponza', 'sponza', 'b', 30)];
  expect(
    compareGroups({ runs: a, directory: true }, { runs: b, directory: true }, { iterations: 10 }).map((c) => [
      c.workload,
      c.ratio,
    ]),
  ).toEqual([
    ['cube', 0.5],
    ['sponza', 1],
  ]);
});
it('pairs renderer configurations independently for matching scenes', () => {
  const a = [run('a-cube', 'cube', 'three-new--ssgi-half', 10), run('a-sponza', 'sponza', 'three-new--ssgi-half', 30)],
    b = [run('b-cube', 'cube', 'three-current', 20), run('b-sponza', 'sponza', 'three-current', 30)];
  const comparisons = compareGroups(
    { runs: a, directory: false, selectorKey: 'renderer' },
    { runs: b, directory: false, selectorKey: 'renderer' },
    { iterations: 10 },
  );
  expect(comparisons.map((c) => [c.workload, c.entryB, c.ratio])).toEqual([
    ['scene=cube', 'b-cube', 0.5],
    ['scene=sponza', 'b-sponza', 1],
  ]);
});
it('pairs scene comparisons by matching renderer configuration IDs', () => {
  const a = [run('cube-base', 'cube', 'three-current', 10), run('cube-optimized', 'cube', 'three-new--ssgi-half', 5)],
    b = [
      run('sponza-base', 'sponza', 'three-current', 20),
      run('sponza-optimized', 'sponza', 'three-new--ssgi-half', 10),
    ];
  const comparisons = compareGroups(
    { runs: a, directory: false, selectorKey: 'scene' },
    { runs: b, directory: false, selectorKey: 'scene' },
    { iterations: 10 },
  );
  expect(comparisons.map((c) => [c.entryA, c.entryB])).toEqual([
    ['cube-base', 'sponza-base'],
    ['cube-optimized', 'sponza-optimized'],
  ]);
});
it('rejects mixed axes, invalid bootstrap controls, and unmatched workloads', () => {
  const group = { runs: [run('cube', 'cube', 'a', 10)], directory: true };
  expect(() => compareGroups(group, group, { iterations: 0 })).toThrow('positive integer');
  expect(() => compareGroups(group, group, { seed: Infinity })).toThrow('finite');
  expect(() => compareGroups(group, { runs: [run('other', 'other', 'b', 10)], directory: true })).toThrow(
    'No matching',
  );
  expect(() =>
    compareGroups(
      { ...group, directory: false, selectorKey: 'renderer' },
      { ...group, directory: false, selectorKey: 'scene' },
    ),
  ).toThrow('same renderer or scene axis');
});
it('accepts only explicit renderer and scene selectors', async () => {
  await expect(selectComparisonGroup('experiment=optimized', '/unused')).rejects.toThrow('renderer=<id>');
  await expect(selectComparisonGroup('renderer=', '/unused')).rejects.toThrow('renderer=<id>');
});
