import { expect, it } from 'vitest';
import { bandwidthChartData } from './bandwidth.js';
import type { ResourceRecord } from './index.js';
const resource = (fields: Partial<ResourceRecord>): ResourceRecord => ({
  url: 'https://test/a.js',
  category: 'script',
  initiatorType: 'script',
  startTime: 0,
  responseStart: 0.005,
  responseEnd: 0.027,
  transferSize: 100,
  encodedBodySize: 80,
  decodedBodySize: 200,
  sizeKnown: true,
  ...fields,
});
it('conserves known bytes across partial bins, overlaps and instantaneous responses', () => {
  const records = [
    resource({}),
    resource({ startTime: 0.002, responseStart: 0.012, responseEnd: 0.012, transferSize: 37 }),
    resource({ sizeKnown: false, transferSize: 1000 }),
    resource({ transferSize: 0 }),
  ];
  for (const sliceDuration of [0.001, 0.01, 0.025, 0.05]) {
    const chart = bandwidthChartData(records, sliceDuration);
    expect(chart.slices.reduce((sum, s) => sum + s.totalBytesPerSecond * (s.t1 - s.t0), 0)).toBeCloseTo(137, 8);
    expect(chart.slices.flatMap((s) => s.contributions).every((c) => c.resourceIndex !== 2)).toBe(true);
    expect(chart.leadIns.find((l) => l.resourceIndex === 1)?.y).toBeGreaterThan(0);
    expect(chart.colors).toEqual(bandwidthChartData(records, sliceDuration).colors);
  }
});
it('handles empty input and rejects unsafe slice sizes', () => {
  expect(bandwidthChartData([]).peakBytesPerSecond).toBe(0);
  expect(() => bandwidthChartData([], 0)).toThrow();
  expect(() => bandwidthChartData([resource({ responseEnd: 1e9 })], 1)).toThrow();
});

it('computes bandwidth in bytes per second from second-based resource timings', () => {
  const chart = bandwidthChartData([resource({ responseStart: 0.01, responseEnd: 0.02, transferSize: 20 })]);
  expect(chart.sliceDuration).toBe(0.01);
  expect(chart.peakBytesPerSecond).toBeCloseTo(2000);
  expect(chart.leadIns[0]).toMatchObject({ t0: 0, t1: 0.01 });
});
