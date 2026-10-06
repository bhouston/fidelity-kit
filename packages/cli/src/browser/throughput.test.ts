import { describe, expect, it } from 'vitest';
import { measureThroughput } from './throughput.js';

describe('GPU-completed throughput', () => {
  it('warms up and drains batches before counting, without per-frame clocks', async () => {
    let clock = 0;
    let submitted = 0;
    let completed = 0;
    let measuring = false;
    const batches: number[] = [];
    let result = 0;
    await measureThroughput(
      {
        draw() {
          submitted++;
        },
        async complete() {
          completed = submitted;
          clock += 100;
        },
      },
      {
        now: () => clock,
        warmupMs: 200,
        durationMs: 500,
        batchSize: 4,
        start() {
          expect(completed).toBe(submitted);
          expect(completed).toBe(8);
          measuring = true;
        },
        batch(count) {
          expect(measuring).toBe(true);
          expect(completed).toBe(submitted);
          batches.push(count);
        },
        end(count) {
          result = count;
        },
      },
    );
    expect(result).toBe(20);
    expect(batches).toEqual([4, 8, 12, 16, 20]);
    expect(completed).toBe(submitted);
  });
  it('drains queued work when drawing fails', async () => {
    let drained = 0;
    await expect(
      measureThroughput(
        {
          draw() {
            throw new Error('device lost');
          },
          async complete() {
            drained++;
          },
        },
        { durationMs: 5000, start() {}, batch() {}, end() {} },
      ),
    ).rejects.toThrow('device lost');
    expect(drained).toBe(1);
  });
});
