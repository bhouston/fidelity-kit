import type { DownloadReport, ResourceRecord } from '../schema/index.js';
const categories = ['script', 'wasm', 'model', 'texture', 'document', 'other'] as const;
export function resourceRecord(entry: PerformanceResourceTiming): ResourceRecord {
  const path = new URL(entry.name, 'https://resource.invalid').pathname.toLowerCase();
  const category =
    entry.entryType === 'navigation'
      ? 'document'
      : path.endsWith('.wasm')
        ? 'wasm'
        : /\.(gltf|glb|obj|fbx|bin|ply|usd[z]?)$/.test(path)
          ? 'model'
          : /\.(png|jpe?g|webp|avif|gif|ktx2?|basis|hdr|exr|dds)$/.test(path)
            ? 'texture'
            : entry.initiatorType === 'script' || /\.[cm]?js$/.test(path)
              ? 'script'
              : 'other';
  return {
    url: entry.name,
    category,
    initiatorType: entry.initiatorType,
    startTime: entry.startTime,
    responseStart: entry.responseStart,
    responseEnd: entry.responseEnd,
    transferSize: entry.transferSize,
    encodedBodySize: entry.encodedBodySize,
    decodedBodySize: entry.decodedBodySize,
    sizeKnown: !(entry.responseStart === 0 && entry.responseEnd > 0),
  };
}
export function downloadReport(resources: ResourceRecord[], phase: DownloadReport['phase']): DownloadReport {
  const byCategory = Object.fromEntries(categories.map((category) => [category, 0])) as DownloadReport['byCategory'];
  let totalTransferBytes = 0,
    totalDecodedBytes = 0,
    unknownSizeCount = 0;
  for (const resource of resources) {
    if (!resource.sizeKnown) {
      unknownSizeCount++;
      continue;
    }
    totalTransferBytes += resource.transferSize;
    totalDecodedBytes += resource.decodedBodySize;
    byCategory[resource.category] += resource.transferSize;
  }
  return { phase, resources, byCategory, totalTransferBytes, totalDecodedBytes, unknownSizeCount };
}
/** Start immediately, retain buffered entries, and drain queued records at each boundary. */
export function observeDownloads(originTime = 0) {
  performance.setResourceTimingBufferSize(5000);
  const entries: PerformanceResourceTiming[] = [];
  let observer: PerformanceObserver | undefined;
  if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('resource')) {
    observer = new PerformanceObserver((list) => entries.push(...(list.getEntries() as PerformanceResourceTiming[])));
    observer.observe({ type: 'resource', buffered: true });
  }
  let reported = 0;
  return {
    snapshot(phase: DownloadReport['phase']) {
      if (observer) entries.push(...(observer.takeRecords() as PerformanceResourceTiming[]));
      else
        entries.splice(0, entries.length, ...(performance.getEntriesByType('resource') as PerformanceResourceTiming[]));
      const pending = entries.slice(reported);
      reported = entries.length;
      if (phase === 'load')
        pending.unshift(...(performance.getEntriesByType('navigation') as PerformanceResourceTiming[]));
      const report = downloadReport(pending.map(resourceRecord), phase);
      for (const resource of report.resources) {
        resource.startTime = Math.max(0, (resource.startTime - originTime) / 1000);
        resource.responseStart = Math.max(0, (resource.responseStart - originTime) / 1000);
        resource.responseEnd = Math.max(0, (resource.responseEnd - originTime) / 1000);
      }
      return report;
    },
    dispose() {
      observer?.disconnect();
      observer = undefined;
    },
  };
}
