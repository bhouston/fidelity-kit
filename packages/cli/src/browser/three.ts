import { attachWebGL, attachWebGPU, type Encoder, type GPUDeviceLike, type GpuTiming } from './gpu.js';
interface PassDescriptor {
  timestampWrites?: unknown;
  [key: string]: unknown;
}
interface InstrumentableEncoder extends Encoder {
  beginRenderPass(descriptor: PassDescriptor): unknown;
  beginComputePass(descriptor?: PassDescriptor): unknown;
  finish(...args: unknown[]): unknown;
}
interface InstrumentableDevice extends GPUDeviceLike {
  createCommandEncoder(...args: unknown[]): InstrumentableEncoder;
  queue: { submit(buffers: unknown[]): void };
}
/** Measures first-to-last GPU pass timestamps per encoder, merged by frame by the reporter. */
export function attachThree(
  renderer: { backend?: { device?: GPUDeviceLike }; getContext?: () => unknown },
  onTiming: (timing: GpuTiming) => void = () => {},
) {
  if (renderer.backend?.device) {
    const device = renderer.backend.device as InstrumentableDevice;
    const timing = attachWebGPU(device, 8, 64);
    const createEncoder = device.createCommandEncoder;
    const submit = device.queue?.submit;
    let frame = -1;
    let disposed = false;
    const pending: number[] = [];
    const hookedCreate = function (this: InstrumentableDevice, ...args: unknown[]) {
      const encoder = createEncoder.apply(this, args);
      const renderPass = encoder.beginRenderPass;
      const computePass = encoder.beginComputePass;
      const finish = encoder.finish;
      let slot: number | undefined;
      const descriptorWithTiming = (descriptor: PassDescriptor = {}) => {
        if (frame < 0 || descriptor.timestampWrites) return descriptor;
        if (slot !== undefined) {
          const timestampWrites = timing.append(slot);
          return timestampWrites ? { ...descriptor, timestampWrites } : descriptor;
        }
        const sample = timing.begin(frame);
        if (!sample) return descriptor;
        slot = sample.slot;
        return { ...descriptor, timestampWrites: sample.timestampWrites };
      };
      encoder.beginRenderPass = function (descriptor) {
        return renderPass.call(this, descriptorWithTiming(descriptor));
      };
      encoder.beginComputePass = function (descriptor) {
        return computePass.call(this, descriptorWithTiming(descriptor));
      };
      encoder.finish = function (...finishArgs) {
        if (slot !== undefined) {
          timing.resolve(this, slot);
          pending.push(slot);
        }
        return finish.apply(this, finishArgs);
      };
      return encoder;
    };
    const hookedSubmit = function (this: InstrumentableDevice['queue'], buffers: unknown[]) {
      submit.call(this, buffers);
      for (const index of pending.splice(0))
        void timing
          .read(index)
          .then((value) => {
            if (value && !disposed) onTiming(value);
          })
          .catch(() => {});
    };
    if (timing.available) {
      device.createCommandEncoder = hookedCreate;
      device.queue.submit = hookedSubmit;
    }
    return {
      api: 'webgpu' as const,
      available: timing.available,
      timing,
      begin(index: number) {
        frame = index;
      },
      end() {
        frame = -1;
      },
      dispose() {
        disposed = true;
        if (device.createCommandEncoder === hookedCreate) device.createCommandEncoder = createEncoder;
        if (device.queue?.submit === hookedSubmit) device.queue.submit = submit;
        timing.dispose();
      },
    };
  }
  const context = renderer.getContext?.();
  if (typeof WebGL2RenderingContext !== 'undefined' && context instanceof WebGL2RenderingContext) {
    const timing = attachWebGL(context);
    return {
      api: 'webgl2' as const,
      available: timing.available,
      timing,
      begin(index: number) {
        for (const value of timing.poll()) onTiming(value);
        timing.begin(index);
      },
      end() {
        timing.end();
      },
      dispose() {
        timing.dispose();
      },
    };
  }
  return {
    api: 'other' as const,
    available: false,
    timing: undefined,
    begin(_index: number) {},
    end() {},
    dispose() {},
  };
}
