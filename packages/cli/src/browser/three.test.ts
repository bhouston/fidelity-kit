// oxlint-disable typescript/no-explicit-any -- Protocol mocks intentionally model browser objects.
import { expect, it, vi } from 'vitest';
import { attachThree } from './three.js';
import { attachWebGPU, type GpuTiming } from './gpu.js';
function mockDevice() {
  const descriptors: { timestampWrites?: { beginningOfPassWriteIndex: number; endOfPassWriteIndex: number } }[] = [];
  const resolve = vi.fn();
  const submit = vi.fn();
  const device = {
    features: new Set(['timestamp-query']),
    createQuerySet: vi.fn(() => ({ destroy: vi.fn() })),
    createBuffer: vi.fn((options: { size: number; usage: number }) => ({
      mapAsync: vi.fn(async () => {}),
      getMappedRange: () => {
        const values = new BigUint64Array(options.size / 8);
        values.set([100n, 110n, 120n, 200n].slice(0, values.length));
        return values.buffer;
      },
      unmap: vi.fn(),
      destroy: vi.fn(),
    })),
    queue: { submit },
    createCommandEncoder: vi.fn(() => ({
      beginRenderPass(descriptor: any) {
        descriptors.push(descriptor);
      },
      beginComputePass(descriptor: any) {
        descriptors.push(descriptor);
      },
      resolveQuerySet: resolve,
      copyBufferToBuffer: vi.fn(),
      finish() {
        return {};
      },
    })),
  };
  return { device, descriptors, resolve, submit };
}
it('Three timestamps cover all passes in the encoder and restore device hooks', async () => {
  const { device, descriptors, resolve, submit } = mockDevice();
  const originalCreate = device.createCommandEncoder;
  const values: GpuTiming[] = [];
  const adapter = attachThree({ backend: { device } }, (value) => values.push(value));
  adapter.begin(7);
  const encoder = device.createCommandEncoder();
  encoder.beginRenderPass({});
  encoder.beginComputePass({});
  const command = encoder.finish();
  device.queue.submit([command]);
  adapter.end();
  await Promise.resolve();
  await Promise.resolve();
  expect(descriptors.map((value) => value.timestampWrites?.beginningOfPassWriteIndex)).toEqual([0, 2]);
  expect(resolve.mock.calls[0]?.[2]).toBe(4);
  expect(values).toEqual([{ frame: 7, gpuStart: '100', gpuEnd: '200' }]);
  expect(submit).toHaveBeenCalledOnce();
  adapter.dispose();
  expect(device.createCommandEncoder).toBe(originalCreate);
  expect(device.queue.submit).toBe(submit);
});
it('GPU query ring skips busy slots and reuses them after asynchronous readback', async () => {
  const { device } = mockDevice();
  const timing = attachWebGPU(device, 1);
  const sample = timing.begin(1)!;
  expect(timing.begin(2)).toBeUndefined();
  expect(await timing.read(sample.slot)).toEqual({ frame: 1, gpuStart: '100', gpuEnd: '110' });
  expect(timing.begin(3)).toBeDefined();
  timing.dispose();
});
