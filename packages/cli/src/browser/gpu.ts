/** Structural WebGPU types keep this package independent of browser GPU type packages. */
export interface QuerySet {
  destroy(): void;
}
export interface ReadBuffer {
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}
export interface Encoder {
  resolveQuerySet(set: QuerySet, first: number, count: number, destination: ReadBuffer, offset: number): void;
  copyBufferToBuffer(
    source: ReadBuffer,
    sourceOffset: number,
    destination: ReadBuffer,
    destinationOffset: number,
    size: number,
  ): void;
}
export interface GPUDeviceLike {
  features: { has(feature: string): boolean };
  createQuerySet(options: { type: string; count: number }): QuerySet;
  createBuffer(options: { size: number; usage: number }): ReadBuffer;
}
export interface GpuTiming {
  frame: number;
  gpuStart: string;
  gpuEnd: string;
}
/** Caller resolves and submits its own encoder; map happens only after submission. */
export function attachWebGPU(device: GPUDeviceLike, ringSize = 4, maxPasses = 1) {
  const available = device.features.has('timestamp-query');
  const slots = available
    ? Array.from({ length: ringSize }, () => ({
        query: device.createQuerySet({ type: 'timestamp', count: maxPasses * 2 }),
        resolve: device.createBuffer({ size: maxPasses * 16, usage: 0x200 | 0x04 }),
        read: device.createBuffer({ size: maxPasses * 16, usage: 0x01 | 0x08 }),
        busy: false,
        frame: -1,
        passes: 0,
      }))
    : [];
  let cursor = 0;
  let disposed = false;
  return {
    available,
    begin(frame: number) {
      if (disposed || !available) return undefined;
      const index = cursor++ % slots.length;
      const slot = slots[index]!;
      if (slot.busy) return undefined;
      slot.busy = true;
      slot.frame = frame;
      slot.passes = 1;
      return {
        slot: index,
        timestampWrites: {
          querySet: slot.query,
          beginningOfPassWriteIndex: 0,
          endOfPassWriteIndex: 1,
        },
      };
    },
    append(index: number) {
      const slot = slots[index];
      if (!slot || !slot.busy || slot.passes >= maxPasses) return undefined;
      const offset = slot.passes++ * 2;
      return { querySet: slot.query, beginningOfPassWriteIndex: offset, endOfPassWriteIndex: offset + 1 };
    },
    resolve(encoder: Encoder, index: number) {
      const slot = slots[index];
      if (!slot || !slot.busy) return;
      encoder.resolveQuerySet(slot.query, 0, slot.passes * 2, slot.resolve, 0);
      encoder.copyBufferToBuffer(slot.resolve, 0, slot.read, 0, slot.passes * 16);
    },
    async read(index: number): Promise<GpuTiming | undefined> {
      const slot = slots[index];
      if (!slot || !slot.busy || disposed) return;
      try {
        await slot.read.mapAsync(1);
        const values = new BigUint64Array(slot.read.getMappedRange());
        return {
          frame: slot.frame,
          gpuStart: values[0]!.toString(),
          gpuEnd: values[slot.passes * 2 - 1]!.toString(),
        };
      } finally {
        slot.read.unmap();
        slot.busy = false;
      }
    },
    dispose() {
      disposed = true;
      for (const slot of slots) {
        slot.query.destroy();
        slot.resolve.destroy();
        slot.read.destroy();
      }
    },
  };
}
export function attachWebGL(gl: WebGL2RenderingContext, ringSize = 4) {
  const extension = gl.getExtension('EXT_disjoint_timer_query_webgl2') as {
    TIME_ELAPSED_EXT: number;
    GPU_DISJOINT_EXT: number;
  } | null;
  const pending: { query: WebGLQuery; frame: number }[] = [];
  let active: { query: WebGLQuery; frame: number } | undefined;
  return {
    available: Boolean(extension),
    begin(frame: number) {
      if (!extension || active || pending.length >= ringSize) return false;
      const query = gl.createQuery();
      if (!query) return false;
      active = { query, frame };
      gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
      return true;
    },
    end() {
      if (!extension || !active) return;
      gl.endQuery(extension.TIME_ELAPSED_EXT);
      pending.push(active);
      active = undefined;
    },
    poll(): GpuTiming[] {
      if (!extension) return [];
      const result: GpuTiming[] = [];
      const disjoint = gl.getParameter(extension.GPU_DISJOINT_EXT);
      for (let index = pending.length - 1; index >= 0; index--) {
        const slot = pending[index]!;
        if (!disjoint && !gl.getQueryParameter(slot.query, gl.QUERY_RESULT_AVAILABLE)) continue;
        if (!disjoint) {
          const elapsed = gl.getQueryParameter(slot.query, gl.QUERY_RESULT) as number;
          result.push({
            frame: slot.frame,
            gpuStart: '0',
            gpuEnd: BigInt(Math.round(elapsed)).toString(),
          });
        }
        gl.deleteQuery(slot.query);
        pending.splice(index, 1);
      }
      return result;
    },
    dispose() {
      if (active && extension) {
        gl.endQuery(extension.TIME_ELAPSED_EXT);
        gl.deleteQuery(active.query);
        active = undefined;
      }
      for (const slot of pending) gl.deleteQuery(slot.query);
      pending.length = 0;
    },
  };
}
