import type { ResourceRecord } from './index.js';
export type Slice = {
  t0: number;
  t1: number;
  contributions: { resourceIndex: number; bytes: number }[];
  totalBytesPerSecond: number;
};
export type BandwidthChartData = {
  sliceDuration: number;
  slices: Slice[];
  leadIns: { resourceIndex: number; t0: number; t1: number; y: number }[];
  colors: string[];
  peakBytesPerSecond: number;
};
/** Uniform arrival is an estimate; bin integration preserves every known wire byte. */
export function bandwidthChartData(resources: ResourceRecord[], sliceDuration = 0.01): BandwidthChartData {
  if (!Number.isFinite(sliceDuration) || sliceDuration <= 0) throw new Error('sliceDuration must be positive');
  const known = resources
    .map((resource, resourceIndex) => ({ resource, resourceIndex }))
    .filter(({ resource }) => resource.sizeKnown)
    .toSorted((a, b) => a.resource.startTime - b.resource.startTime || a.resourceIndex - b.resourceIndex);
  const end = known.reduce(
    (max, { resource }) =>
      Math.max(
        max,
        resource.responseEnd,
        resource.responseStart + (resource.responseEnd <= resource.responseStart ? sliceDuration : 0),
      ),
    0,
  );
  if (Math.ceil(end / sliceDuration) > 100000) throw new Error('Too many bandwidth slices; increase sliceDuration');
  const slices: Slice[] = Array.from({ length: Math.ceil(end / sliceDuration) }, (_, i) => ({
    t0: i * sliceDuration,
    t1: (i + 1) * sliceDuration,
    contributions: [],
    totalBytesPerSecond: 0,
  }));
  const leadIns: BandwidthChartData['leadIns'] = [];
  for (const { resource: r, resourceIndex } of known) {
    const duration = r.responseEnd - r.responseStart;
    const first = Math.floor(r.responseStart / sliceDuration);
    const last = duration > 0 ? Math.ceil(r.responseEnd / sliceDuration) - 1 : first;
    const base = slices[first]?.totalBytesPerSecond ?? 0;
    leadIns.push({ resourceIndex, t0: r.startTime, t1: r.responseStart, y: base });
    for (let i = first; i <= last; i++) {
      const slice = slices[i]!;
      const overlap = Math.max(0, Math.min(slice.t1, r.responseEnd) - Math.max(slice.t0, r.responseStart));
      const bytes = duration > 0 ? (r.transferSize * overlap) / duration : r.transferSize;
      if (bytes > 0) {
        slice.contributions.push({ resourceIndex, bytes });
        slice.totalBytesPerSecond += bytes / sliceDuration;
      }
    }
  }
  const colors = resources.map((r) => {
    const path = new URL(r.url, 'https://resource.invalid').pathname;
    let hash = 0;
    for (const c of path) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) | 0;
    return `hsl(${Math.abs(hash) % 360} 65% 55%)`;
  });
  return {
    sliceDuration,
    slices,
    leadIns,
    colors,
    peakBytesPerSecond: slices.reduce((max, s) => Math.max(max, s.totalBytesPerSecond), 0),
  };
}
