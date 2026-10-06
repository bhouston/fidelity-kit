import type { ReportIndex } from './storage.js';
import type { SuiteIndex } from '../core/process.js';
/** A performance-only export still loads the same unified website, with an empty fidelity catalogue. */
export function performanceSiteIndex(report: ReportIndex): SuiteIndex {
  const renderers = [...new Map(report.results.map((result) => [result.renderer.id, result.renderer])).values()];
  return {
    config: {
      title: 'Performance results',
      renderers: renderers.length
        ? renderers.map((renderer, index) => ({ id: renderer.id, label: renderer.name, reference: index === 0 }))
        : [{ id: 'reference', reference: true }],
      outputs: [{ id: 'beauty', label: 'Beauty' }],
    },
    hasReadme: true,
    root: { path: '', hasReadme: true, groups: [], scenes: [] },
    metrics: {},
  };
}
