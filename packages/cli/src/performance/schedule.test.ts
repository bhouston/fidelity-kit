import { describe, it, expect } from 'vitest';
import { scheduleSuite, isSoftwareAdapter, chromeFlags } from './schedule.js';
import type { Suite } from '../schema/index.js';
const suite: Suite = {
  schemaVersion: 1,
  name: 'test',
  entries: ['a', 'b', 'c'].map((id) => ({
    id,
    name: id,
    url: 'https://example.com',
    durationMs: 100,
    renderer: { id, name: id.toUpperCase() },
    scene: { id: 'cube', name: 'Spinning cube' },
  })),
};
describe('benchmark scheduling', () => {
  it('runs each workload exactly once and preserves stable identifiers', () => {
    expect(scheduleSuite(suite).map((run) => run.entry.id)).toEqual(['a', 'b', 'c']);
  });
  it('selects renderer and scene IDs before scheduling', () => {
    expect(scheduleSuite(suite, { renderer: ['b'] }).map((run) => run.entry.id)).toEqual(['b']);
    expect(scheduleSuite(suite, { renderer: ['a', 'c'], scene: ['cube'] }).map((run) => run.entry.id)).toEqual([
      'a',
      'c',
    ]);
    expect(scheduleSuite(suite, { scene: ['other'] })).toEqual([]);
  });
  it('rejects invalid shuffle seeds', () => {
    expect(() => scheduleSuite(suite, { seed: Infinity })).toThrow('finite');
  });
  it('rejects duplicate flat workloads', () => {
    expect(() =>
      scheduleSuite({ ...suite, entries: [suite.entries[0], { ...suite.entries[0], id: 'duplicate' }] }),
    ).toThrow('Duplicate');
  });
  it('has reproducible seeded order', () => {
    expect(scheduleSuite(suite, { seed: 17 })).toEqual(scheduleSuite(suite, { seed: 17 }));
    expect(scheduleSuite({ ...suite, defaults: { order: 'sequential' } }).map((run) => run.entry.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
  it('rejects known software adapters and records vsync flags', () => {
    expect(isSoftwareAdapter({ description: 'ANGLE SwiftShader' })).toBe(true);
    expect(isSoftwareAdapter({ description: 'Apple M4' })).toBe(false);
    expect(chromeFlags('off')).toContain('--disable-frame-rate-limit');
    expect(chromeFlags('on')).not.toContain('--disable-gpu-vsync');
  });
});
