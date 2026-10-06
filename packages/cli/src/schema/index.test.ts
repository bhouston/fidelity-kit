import { describe, expect, it } from 'vitest';
import {
  assertMessageToHarness,
  assertSuite,
  validateRunResult,
  validateMessageToReporter,
  validateMessageToHarness,
} from './index.js';
describe('schema boundaries', () => {
  it('accepts raw minimal results and rejects derived metrics', () => {
    const result = {
      schemaVersion: 1,
      runId: 'test',
      entry: {
        id: 'cube',
        name: 'Cube',
        renderer: { id: 'three-base', name: 'Three Base' },
        scene: { id: 'cube', name: 'Cube' },
        url: '/cube',
      },
      networkProfile: { name: 'unthrottled', latencyMs: 0, downloadBytesPerSec: -1, uploadBytesPerSec: -1 },
      config: { durationMs: 100, vsync: 'on' },
      harness: { teardown: 1200 },
      reporter: { frames: [{ cpuStart: 1050, cpuEnd: 1051 }] },
      status: 'ok',
    };
    expect(validateRunResult(result)).toBe(true);
    expect(validateRunResult({ ...result, networkProfile: undefined })).toBe(false);
    expect(validateRunResult({ ...result, clockSync: { samples: [] } })).toBe(false);
    expect(validateRunResult({ ...result, config: { ...result.config, warmupMs: 0 } })).toBe(false);
    expect(
      validateRunResult({
        ...result,
        reporter: {
          ...result.reporter,
          blocks: [
            {
              start: 1040,
              end: 1100,
              source: 'loaf',
              scripts: [{ start: 1041, end: 1099, sourceURL: 'renderer.js', invoker: 'requestAnimationFrame' }],
            },
          ],
        },
      }),
    ).toBe(true);
    expect(
      validateRunResult({
        ...result,
        reporter: {
          ...result.reporter,
          blocks: [{ start: 1040, end: 1100, source: 'loaf', scripts: [{ start: 1041, end: 1099, duration: 58 }] }],
        },
      }),
    ).toBe(false);
    expect(validateRunResult({ ...result, median: 16 })).toBe(false);
    expect(
      validateRunResult({
        ...result,
        reporter: { frames: [{ cpuStart: 1, cpuEnd: 2, gpuStart: '1.1' }] },
      }),
    ).toBe(false);
  });
  it('rejects duplicate and unsafe filesystem entry IDs', () => {
    const entry = {
      id: 'cube',
      name: 'Cube',
      renderer: { id: 'three-base', name: 'Three Base' },
      scene: { id: 'cube', name: 'Cube' },
      url: '/cube',
      durationMs: 100,
    };
    expect(() => assertSuite({ schemaVersion: 1, name: 'test', entries: [entry, entry] })).toThrow('duplicate');
    expect(() => assertSuite({ schemaVersion: 1, name: 'test', entries: [{ ...entry, id: '../escape' }] })).toThrow();
  });
  it('permits only a single run per renderer and scene pair', () => {
    const entry = {
      id: 'cube',
      name: 'Cube',
      renderer: { id: 'three-base', name: 'Three Base' },
      scene: { id: 'cube', name: 'Cube' },
      url: '/cube',
      durationMs: 100,
    };
    expect(() =>
      assertSuite({ schemaVersion: 1, name: 'test', defaults: { repetitions: 1 }, entries: [entry] }),
    ).toThrow();
    expect(() =>
      assertSuite({ schemaVersion: 1, name: 'test', defaults: { repetitions: 2 }, entries: [entry] }),
    ).toThrow();
  });
  it('validates directions and binary capture payloads', () => {
    const message = {
      protocol: 'performance-kit',
      protocolVersion: 1,
      runId: 'test',
      seq: 0,
      sentAt: 1,
      type: 'abort',
      payload: { reason: 'cancelled' },
    };
    expect(validateMessageToReporter(message)).toBe(true);
    expect(validateMessageToHarness(message)).toBe(false);
    expect(validateMessageToHarness({ ...message, type: 'capture', payload: { at: 1, bytes: {} } })).toBe(false);
    expect(
      validateMessageToHarness({
        ...message,
        type: 'capture',
        payload: { at: 1, bytes: new ArrayBuffer(8) },
      }),
    ).toBe(true);
  });
});

import { validateSuite, type NamedEntity, type NamedEntityType, type SuiteEntry } from './index.js';
describe('named renderer and scene references', () => {
  const renderer: NamedEntityType = { id: 'three-base', name: 'Three Base renderer' };
  const scene: NamedEntity = { id: 'cornell-metallic', name: 'Cornell metallic sphere' };
  const entry: SuiteEntry = {
    id: 'metallic--three-base',
    name: 'Metallic sphere with Three Base',
    renderer,
    scene,
    url: '/renderer',
    durationMs: 100,
  };
  const suite = { schemaVersion: 1, name: 'Named entities', entries: [entry] };
  const result = {
    schemaVersion: 1,
    runId: 'test',
    entry: {
      id: entry.id,
      name: entry.name,
      renderer,
      scene,
      url: entry.url,
    },
    networkProfile: { name: 'unthrottled', latencyMs: 0, downloadBytesPerSec: -1, uploadBytesPerSec: -1 },
    config: { durationMs: 100, vsync: 'on' },
    harness: { teardown: 2 },
    reporter: { frames: [] },
    status: 'ok',
  };
  it('accepts friendly names with spaces in suites and results', () => {
    expect(validateSuite(suite)).toBe(true);
    expect(validateRunResult(result)).toBe(true);
  });
  it.each(['.', '..', '../escape', 'three/new', 'three\\new', 'renderer with spaces', ''])(
    'rejects unsafe named entity ID %j',
    (id) => {
      for (const key of ['renderer', 'scene'] as const) {
        expect(validateSuite({ ...suite, entries: [{ ...entry, [key]: { id, name: 'Friendly name' } }] })).toBe(false);
        expect(validateRunResult({ ...result, entry: { ...result.entry, [key]: { id, name: 'Friendly name' } } })).toBe(
          false,
        );
      }
    },
  );
  it('rejects unexpected entity properties and missing or empty display names', () => {
    for (const reference of [{ ...renderer, extra: true }, { id: renderer.id }, { ...renderer, name: '' }]) {
      expect(validateSuite({ ...suite, entries: [{ ...entry, renderer: reference }] })).toBe(false);
      expect(validateRunResult({ ...result, entry: { ...result.entry, renderer: reference } })).toBe(false);
    }
  });
  it('requires both named entities and rejects the removed label system', () => {
    for (const key of ['renderer', 'scene'] as const) {
      const missingEntry = { ...entry };
      const missingResultEntry = { ...result.entry };
      delete missingEntry[key];
      delete missingResultEntry[key];
      expect(validateSuite({ ...suite, entries: [missingEntry] })).toBe(false);
      expect(validateRunResult({ ...result, entry: missingResultEntry })).toBe(false);
    }
    expect(validateSuite({ ...suite, entries: [{ ...entry, labels: [] }] })).toBe(false);
    expect(validateRunResult({ ...result, entry: { ...result.entry, labels: [] } })).toBe(false);
  });
});

it('rejects phases without current identity or clock', () => {
  const phase = { id: 0, phase: 'load', start: { clock: 'reporter', t: 1 } };
  const message = {
    protocol: 'performance-kit',
    protocolVersion: 1,
    runId: 'test',
    seq: 0,
    type: 'runEnd',
    sentAt: 1,
    payload: {
      navigationStart: 0,
      ready: 1,
      runStart: 1,
      runEnd: 2,
      frames: [],
      blocks: [],
      watchdogTicks: [],
      downloads: [],
      environment: {},
      phases: [phase],
    },
  };
  expect(() => assertMessageToHarness(message)).not.toThrow();
  expect(() =>
    assertMessageToHarness({ ...message, payload: { ...message.payload, phases: [{ ...phase, id: undefined }] } }),
  ).toThrow();
  expect(() =>
    assertMessageToHarness({
      ...message,
      payload: { ...message.payload, phases: [{ ...phase, start: { clock: 'harness', t: 1 } }] },
    }),
  ).toThrow();
});
