import { expect, it } from 'vitest';
import { uncoveredInitialization } from './initialization.js';
import { processRun, assertProcessedResult, type RunResult } from './index.js';

it('infers leading, internal and trailing gaps while respecting overlapping and unfinished phases', () => {
  expect(
    uncoveredInitialization(
      [
        { start: 20, end: 40 },
        { start: 30, end: 50 },
        { start: 80, end: 90 },
      ],
      0,
      100,
    ),
  ).toEqual([
    { start: 0, end: 20 },
    { start: 50, end: 80 },
    { start: 90, end: 100 },
  ]);
  expect(uncoveredInitialization([{ start: -10, end: 10 }, { start: 20 }], 0, 100)).toEqual([{ start: 10, end: 20 }]);
  expect(uncoveredInitialization([], 0, 100)).toEqual([{ start: 0, end: 100 }]);
  expect(uncoveredInitialization([{ start: 5, end: 4 }], 0, 10)).toEqual([{ start: 0, end: 10 }]);
});
const run: RunResult = {
  schemaVersion: 1,
  runId: 'navigation',
  entry: {
    id: 'test',
    name: 'Test',
    renderer: { id: 'test', name: 'Test' },
    scene: { id: 'test', name: 'Test' },
    url: '/test',
  },
  networkProfile: { name: 'unthrottled', latencyMs: 0, downloadBytesPerSec: -1, uploadBytesPerSec: -1 },
  config: { durationMs: 100, vsync: 'on' },
  harness: { iframeCreated: 0, teardown: 6.5 },
  status: 'ok',
  reporter: {
    navigationStart: 0,
    renderStart: 6.3,
    ready: 6.3,
    runStart: 6.3,
    runEnd: 6.4,
    frames: [6.3, 6.32, 6.34].map((cpuStart) => ({ cpuStart, cpuEnd: cpuStart + 0.001 })),
    phases: [
      { id: 0, phase: 'load', start: { clock: 'reporter', t: 0 }, end: { clock: 'reporter', t: 6.1 } },
      { id: 1, phase: 'compile', start: { clock: 'reporter', t: 6.2 }, end: { clock: 'reporter', t: 6.25 } },
    ],
  },
};
it('includes recorded startup in initialization, retaining exact frame statistics', () => {
  const result = processRun(run);
  assertProcessedResult(result);
  expect(result.timeline.phases.map(({ phase, start }) => ({ phase, start }))).toEqual([
    { phase: 'load', start: 0 },
    { phase: 'unknown', start: 6.1 },
    { phase: 'compile', start: 6.2 },
    { phase: 'unknown', start: 6.25 },
  ]);
  for (const [i, expected] of [6.1, 0.1, 0.05, 0.05].entries())
    expect(result.timeline.phases[i]!.duration).toBeCloseTo(expected, 10);
  expect(result.statistics.initDuration).toBe(6.3);
  expect(result.statistics.phaseDurations.unknown).toBeCloseTo(0.15);
  expect(result.measuredIntervals).toHaveLength(2);
  for (const interval of result.measuredIntervals) expect(interval).toBeCloseTo(0.02, 10);
  expect(result.timing.reporter.navigationStart).toBe(0);
  expect(result.timing.harness).not.toHaveProperty('startSent');
});
