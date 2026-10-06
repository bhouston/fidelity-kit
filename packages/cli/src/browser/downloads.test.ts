import { afterEach, expect, it, vi } from 'vitest';
import { downloadReport, observeDownloads, resourceRecord } from './downloads.js';
const entry = (fields: Partial<PerformanceResourceTiming> = {}) =>
  ({
    name: 'https://test/model.glb?v=1',
    entryType: 'resource',
    initiatorType: 'fetch',
    startTime: 1,
    responseStart: 2,
    responseEnd: 5,
    transferSize: 40,
    encodedBodySize: 30,
    decodedBodySize: 60,
    ...fields,
  }) as PerformanceResourceTiming;
afterEach(() => vi.unstubAllGlobals());
it('categorizes query URLs, navigation, wasm and textures and separates hidden sizes from cache hits', () => {
  expect(resourceRecord(entry()).category).toBe('model');
  expect(resourceRecord(entry({ entryType: 'navigation' })).category).toBe('document');
  expect(resourceRecord(entry({ name: 'https://test/decoder.wasm' })).category).toBe('wasm');
  expect(resourceRecord(entry({ name: 'https://test/a.ktx2' })).category).toBe('texture');
  const report = downloadReport(
    [
      resourceRecord(entry()),
      resourceRecord(entry({ transferSize: 0 })),
      resourceRecord(entry({ responseStart: 0, transferSize: 0, decodedBodySize: 0 })),
    ],
    'load',
  );
  expect(report).toMatchObject({
    totalTransferBytes: 40,
    totalDecodedBytes: 120,
    unknownSizeCount: 1,
    byCategory: { model: 40 },
  });
});
it('drains observer queues at ready, includes navigation once and reports incremental post-load assets', () => {
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- Mutable observer callback captured for this test.
  let callback: (list: { getEntries: () => PerformanceEntry[] }) => void = () => {};
  let pending: PerformanceEntry[] = [entry()];
  const disconnect = vi.fn();
  vi.stubGlobal(
    'PerformanceObserver',
    class {
      static supportedEntryTypes = ['resource'];
      constructor(cb: typeof callback) {
        callback = cb;
      }
      observe = vi.fn();
      takeRecords() {
        const records = pending;
        pending = [];
        return records;
      }
      disconnect = disconnect;
    },
  );
  const buffer = vi.fn();
  vi.stubGlobal('performance', {
    timeOrigin: 1000,
    setResourceTimingBufferSize: buffer,
    getEntriesByType: (type: string) => (type === 'navigation' ? [entry({ entryType: 'navigation' })] : []),
  });
  const observer = observeDownloads();
  const load = observer.snapshot('load');
  expect(load.resources).toHaveLength(2);
  expect(buffer).toHaveBeenCalledWith(5000);
  callback({ getEntries: () => [entry({ name: 'https://test/lazy.ktx2' })] });
  expect(observer.snapshot('post-load').resources.map((r) => r.category)).toEqual(['texture']);
  observer.dispose();
  expect(disconnect).toHaveBeenCalled();
});
