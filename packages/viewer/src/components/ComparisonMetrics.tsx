import type { MetricsRecord, TemporalSummary } from 'fidelity-kit';
import { formatMetric, psnrClassName } from '../lib/view';

/** Temporal measurements do not depend on static snapshot processing. */
export function ComparisonMetrics({
  metrics,
  temporal,
  isTemporal,
}: {
  metrics?: MetricsRecord;
  temporal?: TemporalSummary;
  isTemporal: boolean;
}) {
  if (isTemporal)
    return temporal ? (
      <dl className="grid max-w-md grid-cols-2 gap-x-4 gap-y-1 p-2 font-mono text-sm">
        <dt>Sequence PSNR (dB)</dt>
        <dd>{formatMetric(temporal.psnr)}</dd>
        <dt>Temporal PSNR (dB)</dt>
        <dd>{formatMetric(temporal.temporalPsnr)}</dd>
        <dt>Sequence sharpness</dt>
        <dd>{formatMetric(temporal.sharpness, 3)}</dd>
        <dt>Frames</dt>
        <dd>{temporal.frames}</dd>
      </dl>
    ) : (
      <p className="text-sm text-muted-foreground">No temporal metrics yet. Run `fidelity-kit temporal`.</p>
    );
  return metrics ? (
    <dl className={`grid max-w-md grid-cols-2 gap-x-4 gap-y-1 p-2 font-mono text-sm ${psnrClassName(metrics)}`}>
      <dt>PSNR (dB)</dt>
      <dd>{formatMetric(metrics.psnr)}</dd>
      <dt>Sharpness</dt>
      <dd>{formatMetric(metrics.sharpness, 3)}</dd>
    </dl>
  ) : (
    <p className="text-sm text-muted-foreground">No static metrics yet. Run `fidelity-kit process`.</p>
  );
}
