import { bandwidthChartData, type ProcessedResult } from 'fidelity-kit/schema';
import { useEffect, useRef, useState } from 'react';
import { chartLayout, timeTicks } from './report.js';
import { humanizeBytes } from 'humanize-units';
const bytes = humanizeBytes;
export function Bandwidth({ result, maxTime }: { result: ProcessedResult; maxTime: number }) {
  const ref = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(1000);
  const visible = result.downloads !== undefined;
  useEffect(() => {
    if (!visible) return;
    const node = ref.current;
    if (!node) return;
    const resize = () => setWidth(node.clientWidth);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);
  if (!result.downloads) return <p>Download measurement unavailable for this result.</p>;
  const resources = result.downloads.flatMap((report) => report.resources);
  const end = resources.reduce((max, r) => Math.max(max, r.responseEnd), 0);
  const data = bandwidthChartData(resources, Math.max(0.01, Math.ceil(end / 5000 / 0.01) * 0.01));
  const height = 220;
  const { left, right, x } = chartLayout(width, maxTime);
  const y = (rate: number) => height - 28 - (rate / (data.peakBytesPerSecond || 1)) * (height - 42);
  const paths = new Map<number, string>();
  for (const slice of data.slices) {
    let base = 0;
    for (const contribution of slice.contributions) {
      const top = base + contribution.bytes / data.sliceDuration;
      const path = `M${x(slice.t0)},${y(base)}H${x(slice.t1)}V${y(top)}H${x(slice.t0)}Z`;
      paths.set(contribution.resourceIndex, (paths.get(contribution.resourceIndex) ?? '') + path);
      base = top;
    }
  }
  const total = result.downloads.reduce((sum, r) => sum + r.totalTransferBytes, 0);
  const unknown = result.downloads.reduce((sum, r) => sum + r.unknownSizeCount, 0);
  return (
    <section>
      <h3>Bandwidth · {result.networkProfile.name}</h3>
      <p>
        {bytes(total)} known transfer · peak {bytes(data.peakBytesPerSecond)}/s · {unknown} requests with hidden sizes
      </p>
      <svg
        ref={ref}
        viewBox={`0 0 ${width} ${height}`}
        aria-label="Download bandwidth and request waiting times"
        style={{ width: '100%' }}
      >
        {[0, 0.5, 1].map((fraction) => (
          <text key={fraction} x="0" y={y(data.peakBytesPerSecond * fraction)} fill="currentColor" fontSize="10">
            {((data.peakBytesPerSecond * fraction) / 1e6).toFixed(2)}
          </text>
        ))}
        <defs>
          <clipPath id={`network-${result.runId}`}>
            <rect x="44" y="10" width={right - left} height={height - 38} />
          </clipPath>
        </defs>
        {timeTicks(maxTime, right - left).map((second) => {
          return (
            <g key={Number(second.toFixed(2))}>
              <line x1={x(second)} x2={x(second)} y1="10" y2={height - 28} stroke="currentColor" opacity="0.12" />
              <text
                textAnchor={second === maxTime ? 'end' : 'start'}
                x={x(second)}
                y={height - 8}
                fill="currentColor"
                fontSize="10"
              >
                {Number(second.toFixed(2))}s
              </text>
            </g>
          );
        })}
        <g clipPath={`url(#network-${result.runId})`}>
          {[...paths].map(([index, path]) => (
            <path key={index} d={path} fill={data.colors[index]}>
              <title>
                {resources[index]!.url} · {bytes(resources[index]!.transferSize)} · wait{' '}
                {((resources[index]!.responseStart - resources[index]!.startTime) * 1000).toFixed(1)} ms · download{' '}
                {((resources[index]!.responseEnd - resources[index]!.responseStart) * 1000).toFixed(1)} ms
              </title>
            </path>
          ))}
          {data.leadIns.map((lane) => (
            <line
              key={lane.resourceIndex}
              x1={x(lane.t0)}
              x2={x(lane.t1)}
              y1={y(lane.y)}
              y2={y(lane.y)}
              stroke={data.colors[lane.resourceIndex]}
              strokeDasharray="2 3"
            >
              <title>{resources[lane.resourceIndex]!.url} · waiting</title>
            </line>
          ))}
          {result.timeline.renderStart !== undefined && (
            <line
              x1={x(result.timeline.renderStart!)}
              x2={x(result.timeline.renderStart!)}
              y1="10"
              y2={height - 28}
              stroke="currentColor"
              strokeDasharray="5 3"
            >
              <title>Init done</title>
            </line>
          )}
        </g>
        <text x="0" y={height - 8} fill="currentColor" fontSize="10">
          MB/s
        </text>
      </svg>
      <table>
        <thead>
          <tr>
            <th>Phase</th>
            <th>Wire bytes</th>
            <th>Decoded bytes</th>
            <th>Breakdown</th>
          </tr>
        </thead>
        <tbody>
          {result.downloads.map((report) => (
            <tr key={report.phase}>
              <td>{report.phase}</td>
              <td>{bytes(report.totalTransferBytes)}</td>
              <td>{bytes(report.totalDecodedBytes)}</td>
              <td>
                {Object.entries(report.byCategory)
                  .filter(([, size]) => size > 0)
                  .map(([name, size]) => `${name}: ${bytes(size)}`)
                  .join(' · ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <details>
        <summary>Request waterfall ({resources.length})</summary>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>URL</th>
                <th>Start</th>
                <th>Wait</th>
                <th>Download</th>
                <th>Wire size</th>
              </tr>
            </thead>
            <tbody>
              {resources
                .toSorted((a, b) => a.startTime - b.startTime)
                .map((r, i) => (
                  <tr key={i}>
                    <td style={{ overflowWrap: 'anywhere' }}>{r.url}</td>
                    <td>{r.startTime.toFixed(3)}s</td>
                    <td>{r.sizeKnown ? `${((r.responseStart - r.startTime) * 1000).toFixed(1)}ms` : 'hidden'}</td>
                    <td>{r.sizeKnown ? `${((r.responseEnd - r.responseStart) * 1000).toFixed(1)}ms` : 'hidden'}</td>
                    <td>{r.sizeKnown ? bytes(r.transferSize) : 'unknown (TAO)'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
