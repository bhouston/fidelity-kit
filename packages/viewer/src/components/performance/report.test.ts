import { expect, it } from 'vitest';
import { processRun, type RunResult } from 'fidelity-kit/schema';
import {
  gradeMetric,
  cardMetrics,
  compareMetrics,
  chartScale,
  chartLayout,
  timeTicks,
  phaseColor,
  readRoute,
  resultId,
  metricTable,
} from './report.js';
const run: RunResult = {
  schemaVersion: 1,
  runId: 'test',
  entry: { id: 'entry', name: 'Entry', renderer: { id: 'a', name: 'A' }, scene: { id: 'b', name: 'B' }, url: '/test' },
  networkProfile: { name: 'unthrottled', latencyMs: 0, downloadBytesPerSec: -1, uploadBytesPerSec: -1 },
  config: { durationMs: 1000, vsync: 'on' },
  harness: { teardown: 1 },
  status: 'ok',
  reporter: {
    navigationStart: 0,
    ready: 0.1,
    renderStart: 0.1,
    runStart: 0.1,
    runEnd: 1,
    frames: [0.1, 0.11, 0.14].map((cpuStart) => ({ cpuStart, cpuEnd: cpuStart + 0.001 })),
    watchdogTicks: [0, 0.016, 0.096],
  },
};
it('uses means rather than medians, max absolute jitter and worst delay', () => {
  const metrics = cardMetrics(processRun(run));
  expect(metrics.initTime).toBe(100);
  expect(metrics.avgFrameRate).toBeCloseTo(50, 10);
  expect(metrics.maxJitter).toBeCloseTo(10, 10);
  expect(metrics.worstResponsiveness).toBe(64);
  expect(metrics.download).toBeUndefined();
  const empty = processRun({ ...run, reporter: { frames: [] } });
  expect(cardMetrics(empty)).toEqual({
    initTime: undefined,
    avgFrameRate: undefined,
    maxJitter: undefined,
    worstResponsiveness: undefined,
    download: undefined,
    timeToTarget: undefined,
  });
});
it('sorts each metric in both directions and leaves missing observations last', () => {
  const a = processRun(run),
    b = structuredClone(a),
    empty = processRun({ ...run, reporter: { frames: [] } });
  b.statistics.initDuration = 0.2;
  b.statistics.averageFps = 25;
  b.statistics.maxJitter = 0.02;
  b.statistics.worstResponsiveness = 0.2;
  for (const key of Object.keys(metricTable).filter(
    (metric) => metric !== 'download' && metric !== 'timeToTarget',
  ) as (keyof typeof metricTable)[]) {
    expect(compareMetrics(a, b, key, 'bestFirst')).toBeLessThan(0);
    expect(compareMetrics(a, b, key, 'worstFirst')).toBeGreaterThan(0);
    expect(compareMetrics(a, empty, key, 'worstFirst')).toBeLessThan(0);
    expect(compareMetrics(empty, empty, key, 'bestFirst')).toBe(0);
  }
});
it('grades exact init and jitter boundaries and established FPS/responsiveness categories', () => {
  expect([249, 250, 499, 500].map((v) => gradeMetric('initTime', v))).toEqual(['good', 'warn', 'warn', 'bad']);
  expect([4.9, 5, 14.9, 15].map((v) => gradeMetric('maxJitter', v))).toEqual(['good', 'warn', 'warn', 'bad']);
  expect([60, 30, 20].map((v) => gradeMetric('avgFrameRate', v))).toEqual(['good', 'warn', 'bad']);
  expect([49, 50, 299, 300].map((v) => gradeMetric('worstResponsiveness', v))).toEqual(['good', 'warn', 'warn', 'bad']);
  expect(gradeMetric('initTime', undefined)).toBe('none');
  expect(gradeMetric('maxJitter', NaN)).toBe('none');
});
it('uses configured colors and deterministic legible fallback including prototype names', () => {
  expect(phaseColor('assets', { assets: 'rebeccapurple' })).toBe('rebeccapurple');
  expect(phaseColor('assets')).toBe(phaseColor('assets'));
  expect(phaseColor('__proto__')).toMatch(/^hsl\(\d+ 65% 58%\)$/);
});
it('covers observed values with exactly four nice divisions, including large stalls', () => {
  expect(chartScale(16.7)).toEqual({ max: 20, ticks: [0, 5, 10, 15, 20] });
  expect(chartScale(55).max).toBe(100);
  for (const max of [0, 33, 400, 401, 900, 4001, 1e6]) {
    const scale = chartScale(max);
    expect(scale.max).toBeGreaterThanOrEqual(max);
    expect(scale.ticks).toHaveLength(5);
  }
});
it('roundtrips shareable sort, detail and filter URLs and defaults invalid options', () => {
  expect(
    readRoute(
      new URL('https://example.test/?result=x&sort=avgFrameRate&dir=worstFirst&q=cube&machine=m&renderer=a&scene=b'),
    ),
  ).toEqual({
    result: 'x',
    sort: 'avgFrameRate',
    direction: 'worstFirst',
    query: 'cube',
    machine: 'm',
    renderer: 'a',
    scene: 'b',
  });
  expect(readRoute(new URL('https://example.test/?sort=__proto__&dir=no')).sort).toBe('avgFrameRate');
  expect(readRoute(new URL('https://example.test/'))).toMatchObject({ sort: 'avgFrameRate', direction: 'bestFirst' });
  const a = processRun(run),
    b = structuredClone(a);
  b.entry.renderer.id = 'a-b';
  b.entry.scene.id = 'c';
  a.entry.scene.id = 'b-c';
  expect(resultId(a)).not.toBe(resultId(b));
});
it('sorts Download in both directions by total transferred bytes and retains missing values last', () => {
  const a = processRun(run),
    b = processRun(run),
    missing = processRun(run);
  const report = {
    phase: 'load' as const,
    timeOrigin: 0,
    totalTransferBytes: 100,
    totalDecodedBytes: 200,
    unknownSizeCount: 0,
    byCategory: { script: 100, wasm: 0, model: 0, texture: 0, document: 0, other: 0 },
    resources: [],
  };
  a.downloads = [report, { ...report, phase: 'post-load', totalTransferBytes: 50 }];
  b.downloads = [{ ...report, totalTransferBytes: 200 }];
  expect(cardMetrics(a).download).toBe(150);
  expect(compareMetrics(a, b, 'download', 'bestFirst')).toBeLessThan(0);
  expect(compareMetrics(a, b, 'download', 'worstFirst')).toBeGreaterThan(0);
  expect(compareMetrics(missing, a, 'download', 'bestFirst')).toBeGreaterThan(0);
  expect(compareMetrics(missing, a, 'download', 'worstFirst')).toBeGreaterThan(0);
  expect(readRoute(new URL('https://test/?performanceSort=download')).sort).toBe('download');
});

it('sorts observed time-to-target by elapsed time and keeps unreached targets last', () => {
  const a = processRun(run),
    b = processRun(run);
  a.convergence = { width: 1, height: 1, interval: 1, targetPsnr: 30, samples: [], timeToTarget: 0.5 };
  b.convergence = { ...a.convergence, timeToTarget: 1 };
  expect(cardMetrics(a).timeToTarget).toBe(500);
  expect(compareMetrics(a, b, 'timeToTarget', 'bestFirst')).toBeLessThan(0);
  expect(compareMetrics(a, b, 'timeToTarget', 'worstFirst')).toBeGreaterThan(0);
  delete b.convergence.timeToTarget;
  expect(compareMetrics(a, b, 'timeToTarget', 'worstFirst')).toBeLessThan(0);
  expect(gradeMetric('timeToTarget', 500)).toBe('none');
});

it('uses shared horizontal geometry: ten seconds ends two-thirds across a fifteen-second range', () => {
  const chart = chartLayout(1000, 15);
  expect((chart.x(10) - chart.left) / (chart.right - chart.left)).toBeCloseTo(2 / 3);
  expect(chart.right).toBe(840);
  expect(chart.x(15)).toBe(chart.right);
  expect(chart.x(20)).toBe(chart.right);
  const mobile = chartLayout(390, 15);
  expect((mobile.x(10) - mobile.left) / (mobile.right - mobile.left)).toBeCloseTo(2 / 3);
  for (const [end, width] of [
    [15, 600],
    [0.5, 200],
    [5, 100],
    [10000, 200],
  ] as const) {
    const ticks = timeTicks(end, width);
    expect(ticks[0]).toBe(0);
    expect(ticks.at(-1)).toBe(end);
    expect(ticks.length).toBeLessThanOrEqual(14);
  }
});
