import { describe, expect, it } from 'vitest';
import { compareRuns, deriveRun } from './derive.js';
import { downsampleExtrema, processRun } from './process.js';
import { assertProcessedResult, validateProcessedResult, type RunResult } from './index.js';
function raw(count = 5000): RunResult {
  let time = 0.01;
  const frames = Array.from({ length: count }, (_, index) => {
    time += index === 2377 ? 0.2 : index % 101 === 0 ? 0.003 : 0.01;
    return { cpuStart: time, cpuEnd: time + (index === 2700 ? 0.035 : 0.002), gpuStart: '1000000', gpuEnd: '4000000' };
  });
  return {
    schemaVersion: 1,
    runId: 'offset-fixture',
    entry: {
      id: 'cube',
      name: 'Cube',
      renderer: { id: 'three-base', name: 'Three Base' },
      scene: { id: 'cube', name: 'Cube' },
      url: '/cube',
    },
    networkProfile: { name: 'unthrottled', latencyMs: 0, downloadBytesPerSec: -1, uploadBytesPerSec: -1 },
    config: { durationMs: 60000, vsync: 'on' },
    harness: { teardown: time + 0.02 },
    reporter: {
      navigationStart: 0,
      ready: 0.005,
      renderStart: 0.005,
      runStart: 0.01,
      runEnd: time + 0.001,
      frames,
      phases: [{ id: 0, phase: 'load', start: { clock: 'reporter', t: 0 }, end: { clock: 'reporter', t: 0.004 } }],
      watchdogTicks: [0, 0.001, 0.005],
    },
    status: 'ok',
  };
}
describe('seconds-offset preprocessing', () => {
  it('uses complete data for statistics and preserves spikes in reduced display indices', () => {
    const input = raw();
    const original = structuredClone(input);
    const derived = deriveRun(input);
    const metrics = processRun(input);
    expect(input).toEqual(original);
    for (const [output, source] of [
      ['median', 'median'],
      ['p95', 'p95'],
      ['p99', 'p99'],
      ['iqr', 'iqr'],
      ['mad', 'mad'],
      ['initDuration', 'initMs'],
      ['initMaxBlockDuration', 'initMaxBlockMs'],
      ['initBlockedDuration', 'initBlockedMs'],
    ] as const)
      expect(metrics.statistics[output]).toBe(derived[source]! / 1000);
    expect(metrics.statistics.typicalFps).toBe(derived.fps);
    expect(metrics.statistics.intervalCount).toBe(4999);
    expect(metrics.statistics.frameCount).toBe(5000);
    expect(metrics.statistics.phaseDurations).toEqual({ load: 0.004, unknown: 0.001 });
    expect(metrics.statistics.cpuMedian).toBeCloseTo(0.002);
    expect(metrics.statistics.gpuMedian).toBe(0.003);
    expect(metrics.timeline.frameTimes).toEqual(input.reporter.frames.map((frame) => frame.cpuStart));
    expect(metrics.timeline.frameIndices.length).toBeLessThanOrEqual(1536);
    expect(metrics.timeline.watchdogIndices.length).toBeLessThanOrEqual(512);
    expect(
      Math.max(
        ...metrics.timeline.frameIndices.flatMap((index) =>
          index + 1 < 5000 ? [metrics.timeline.frameTimes[index + 1]! - metrics.timeline.frameTimes[index]!] : [],
        ),
      ),
    ).toBeCloseTo(0.2);
    expect(Math.max(...metrics.timeline.cpuDurations.filter((value): value is number => value !== null))).toBeCloseTo(
      0.035,
    );
    expect(metrics.measuredIntervals).toHaveLength(4999);
    assertProcessedResult(metrics);
    expect(JSON.stringify(metrics).length).toBeLessThan(JSON.stringify(input).length);
  });
  it('excludes frames outside measurement and ends the chart exactly at completion', () => {
    const input = raw(6);
    input.reporter.runStart = 0.03;
    input.reporter.runEnd = 0.054;
    input.reporter.frames.unshift({ cpuStart: 0, cpuEnd: 0.001 });
    input.reporter.phases!.push({
      id: 1,
      phase: 'late',
      start: { clock: 'reporter', t: 0.2 },
      end: { clock: 'reporter', t: 0.3 },
    });
    input.reporter.blocks = [{ start: 0.2, end: 0.4, source: 'loaf' }];
    const metrics = processRun(input);
    expect(metrics.timeline.frameTimes).toHaveLength(5);
    expect(metrics.statistics.frameCount).toBe(3);
    expect(metrics.timeline.maxTime).toBe(0.054);
    expect(metrics.timeline.runEnd).toBe(0.054);
  });
  it('stores full precision offsets directly without rebasing to an epoch or rounding', () => {
    const input = raw(3);
    input.reporter.frames = [0.015123456, 0.031790123, 0.04845678].map((cpuStart) => ({
      cpuStart,
      cpuEnd: cpuStart + 0.00234567,
    }));
    input.reporter.runEnd = 0.1;
    const metrics = processRun(input);
    expect(metrics.timeline.frameTimes).toEqual(input.reporter.frames.map((frame) => frame.cpuStart));
    expect(metrics.timeline.cpuDurations[0]).toBeCloseTo(0.00234567, 12);
    expect(metrics.timing.reporter.runEnd).toBe(input.reporter.runEnd);
    expect(metrics.timing.harness.teardown).toBe(input.harness.teardown);
    expect(metrics).not.toHaveProperty('clockSync');
    expect(metrics.statistics).not.toHaveProperty('offsetSeconds');
    expect(metrics.timing).not.toHaveProperty('messages');
  });
  it('aligns nullable CPU/GPU costs and rejects invalid sample references', () => {
    const input = raw(3);
    input.reporter.frames[1]!.cpuEnd = input.reporter.frames[1]!.cpuStart - 0.001;
    delete input.reporter.frames[1]!.gpuStart;
    delete input.reporter.frames[1]!.gpuEnd;
    const metrics = processRun(input);
    expect(metrics.timeline.cpuDurations[1]).toBeNull();
    expect(metrics.timeline.gpuDurations).toEqual([0.003, null, 0.003]);
    expect(validateProcessedResult(metrics)).toBe(true);
    for (const patch of [
      { cpuDurations: [2, 2] },
      { frameIndices: [0, 3] },
      { frameIndices: [2, 0] },
      { watchdogIndices: [0] },
    ])
      expect(validateProcessedResult({ ...metrics, timeline: { ...metrics.timeline, ...patch } })).toBe(false);
  });
  it('retains initialization responsiveness and merges overlapping stalls', () => {
    const input = raw(3);
    input.reporter.ready = input.reporter.renderStart = input.reporter.runStart = 0.1;
    input.reporter.runEnd = 0.2;
    input.reporter.watchdogTicks = [0, 0.016, 0.096];
    input.reporter.blocks = [{ start: 0.03, end: 0.1, source: 'loaf' }];
    const metrics = processRun(input);
    expect(metrics.timeline.blocks).toEqual([{ start: 0.03, duration: 0.07, sources: ['loaf', 'watchdog'] }]);
    expect(metrics.timeline.watchdogTimes.every((t) => t <= metrics.timeline.runStart!)).toBe(true);
  });
  it('preserves download offsets and network rates directly', () => {
    const input = raw(2);
    input.networkProfile = { name: 'slow-4g', latencyMs: 150, downloadBytesPerSec: 200000, uploadBytesPerSec: 93750 };
    input.reporter.downloads = [
      {
        phase: 'load',
        totalTransferBytes: 20,
        totalDecodedBytes: 40,
        unknownSizeCount: 0,
        byCategory: { script: 20, wasm: 0, model: 0, texture: 0, document: 0, other: 0 },
        resources: [
          {
            url: '/a.js',
            category: 'script',
            initiatorType: 'script',
            startTime: 0.001,
            responseStart: 0.002,
            responseEnd: 0.003,
            transferSize: 20,
            encodedBodySize: 20,
            decodedBodySize: 40,
            sizeKnown: true,
          },
        ],
      },
    ];
    const metrics = processRun(input);
    expect(metrics.downloads).toEqual(input.reporter.downloads);
    expect(metrics.networkProfile).toEqual({
      name: 'slow-4g',
      latency: 0.15,
      downloadBytesPerSec: 200000,
      uploadBytesPerSec: 93750,
    });
    assertProcessedResult(metrics);
  });
  it('keeps failed results empty and rejects raw payload leakage', () => {
    const input = raw(0);
    input.status = 'timeout';
    input.reporter = { frames: [] };
    const metrics = processRun(input);
    expect(metrics.timeline.maxTime).toBe(0);
    expect(metrics.measuredIntervals).toEqual([]);
    for (const extra of [
      { reporter: { frames: [] } },
      { frames: [] },
      { clockSync: { samples: [] } },
      { messages: [] },
    ])
      expect(validateProcessedResult({ ...metrics, ...extra })).toBe(false);
    expect(validateProcessedResult(metrics)).toBe(true);
  });
});
describe('extrema-preserving sampling', () => {
  it('keeps endpoints, chronological extrema and a strict point bound', () => {
    const points = Array.from({ length: 10000 }, (_, index) => ({
      t: index,
      value: index === 4999 ? 999 : index === 5000 ? -999 : index % 10,
    }));
    const sampled = downsampleExtrema(points, 100);
    expect(sampled.length).toBeLessThanOrEqual(100);
    expect(sampled[0]).toEqual(points[0]);
    expect(sampled.at(-1)).toEqual(points.at(-1));
    expect(sampled).toContainEqual(points[4999]);
    expect(sampled).toContainEqual(points[5000]);
    expect(sampled.every((point, index) => index === 0 || point.t > sampled[index - 1]!.t)).toBe(true);
  });
  it('copies small series and validates bounds', () => {
    const points = [{ t: 0, value: 2 }];
    expect(downsampleExtrema(points)).toEqual(points);
    expect(downsampleExtrema(points)[0]).not.toBe(points[0]);
    for (const limit of [0, 3, 1001, NaN, 4.5]) expect(() => downsampleExtrema(points, limit)).toThrow('Point limit');
  });
});

it('reports sampled time-to-target from render start without extrapolating an unreached target', () => {
  const run = raw(10);
  run.reporter.runStart = 1;
  run.reporter.runEnd = 5;
  run.reporter.convergence = {
    width: 1,
    height: 1,
    interval: 1,
    targetPsnr: 30,
    samples: [
      { at: 0.5, frame: 0, mse: 0, psnr: null }, // Outside the measured window.
      { at: 1.1, frame: 1, mse: 100, psnr: 28.13 },
      { at: 2.1, frame: 12, mse: 10, psnr: 38.13 },
      { at: 3.1, frame: 20, mse: 100, psnr: 28.13 }, // A later drop does not erase first observed arrival.
    ],
  };
  const processed = processRun(run);
  expect(processed.convergence?.timeToTarget).toBeCloseTo(1.1);
  expect(processed.convergence?.framesToTarget).toBe(12);
  assertProcessedResult(processed);
  run.reporter.convergence.targetPsnr = 50;
  expect(processRun(run).convergence?.timeToTarget).toBeUndefined();
  run.reporter.convergence.samples.push({ at: 4, frame: 25, mse: 0, psnr: null });
  expect(processRun(run).convergence?.timeToTarget).toBe(3);
});

it('processes completed-frame throughput without inventing frame timings', () => {
  const input = raw(0);
  input.config.vsync = 'off';
  input.reporter.throughput = { completedFrames: 500, elapsed: 5 };
  const result = processRun(input);
  assertProcessedResult(result);
  expect(result.statistics.frameCount).toBe(500);
  expect(result.statistics.averageFps).toBe(100);
  expect(result.statistics.cpuSampleCount).toBe(0);
  expect(result.measuredIntervals).toEqual([]);
  expect(result.statistics.p95).toBeUndefined();
  const slower = structuredClone(result);
  slower.throughput!.completedFrames = 250;
  expect(compareRuns([result], [slower], { iterations: 10 }).ratio).toBe(0.5);
  expect(() => compareRuns([result], [processRun(raw())])).toThrow();
});
