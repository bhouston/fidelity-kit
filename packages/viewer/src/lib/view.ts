import type { MetricsRecord, SceneNode, SuiteIndex } from 'fidelity-kit';
import { deltaFile, imageFile, metricsFile } from 'fidelity-kit/paths';

export type Sort = 'name' | 'psnr-asc' | 'psnr-desc';
export interface ViewSearch {
  q?: string;
  /** comma-joined tag list; a scene must have all of them */
  tags?: string;
  output?: string;
  ref?: string;
  /** undefined = the suite default (fidelity.json "delta") */
  deltas?: boolean;
  sort?: Sort;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);

export function validateViewSearch(s: Record<string, unknown>): ViewSearch {
  const sort = s.sort === 'psnr-asc' || s.sort === 'psnr-desc' ? s.sort : undefined;
  return {
    q: str(s.q),
    tags: str(s.tags),
    output: str(s.output),
    ref: str(s.ref),
    deltas: typeof s.deltas === 'boolean' ? s.deltas : undefined,
    sort,
  };
}

export const SORT_OPTIONS: { value: Sort; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'psnr-asc', label: 'PSNR, worst first' },
  { value: 'psnr-desc', label: 'PSNR, best first' },
];

/** Image URL; `?v=<hash>` (when the server knows the file's hash) lets caches keep it as immutable. */
export const fileUrl = (scenePath: string, output: string, file: string, hashes: Record<string, string> = {}) => {
  const parts = [...scenePath.split('/'), output, file];
  const hash = hashes[parts.join('/')];
  return `data/${parts.map(encodeURIComponent).join('/')}${hash ? `?v=${encodeURIComponent(hash)}` : ''}`;
};

export interface View {
  output: string;
  ref: string;
  showDeltas: boolean;
  references: string[];
  /** every renderer except the selected reference, in config order */
  compared: string[];
  label: (id: string) => string;
  /** rel path -> content hash, for versioned image URLs */
  hashes: Record<string, string>;
}

export function resolveView(index: SuiteIndex, search: ViewSearch, hashes: Record<string, string> = {}): View {
  const { renderers, outputs, delta } = index.config;
  const references = renderers.filter((r) => r.reference).map((r) => r.id);
  const output = outputs.find((o) => o.id === search.output)?.id ?? outputs[0]!.id;
  const ref = references.includes(search.ref ?? '') ? search.ref! : references[0]!;
  const labels = new Map(renderers.map((r) => [r.id, r.label ?? r.id]));
  return {
    output,
    ref,
    showDeltas: delta && (search.deltas ?? true),
    references,
    compared: renderers.map((r) => r.id).filter((id) => id !== ref),
    label: (id) => labels.get(id) ?? id,
    hashes,
  };
}

export const metricsOf = (index: SuiteIndex, scene: SceneNode, v: View, renderer: string): MetricsRecord | undefined =>
  index.metrics[`${scene.path}/${v.output}/${metricsFile(renderer, v.ref)}`];

export const renderUrl = (scene: SceneNode, v: View, renderer: string) =>
  scene.images[v.output]?.includes(renderer) ? fileUrl(scene.path, v.output, imageFile(renderer), v.hashes) : undefined;

export const deltaUrl = (index: SuiteIndex, scene: SceneNode, v: View, renderer: string) =>
  metricsOf(index, scene, v, renderer)
    ? fileUrl(scene.path, v.output, deltaFile(renderer, v.ref), v.hashes)
    : undefined;

/** Pixel size of a scene's images in this view (a reference and its test always match), from any metrics record. */
export function sceneSize(index: SuiteIndex, scene: SceneNode, v: View): { width: number; height: number } | undefined {
  for (const r of v.compared) {
    const m = metricsOf(index, scene, v, r);
    if (m) return { width: m.width, height: m.height };
  }
  return undefined;
}

/** Mean PSNR over the compared renderers (identical = 100 dB); undefined when nothing has metrics. */
function score(index: SuiteIndex, scene: SceneNode, v: View): number | undefined {
  const values = v.compared.flatMap((r) => {
    const m = metricsOf(index, scene, v, r);
    return m ? [m.psnr ?? 100] : [];
  });
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined;
}

export function allTags(scenes: SceneNode[]): string[] {
  return [...new Set(scenes.flatMap((s) => s.tags))].toSorted();
}

export function selectScenes(index: SuiteIndex, scenes: SceneNode[], search: ViewSearch, v: View): SceneNode[] {
  const q = search.q?.toLowerCase();
  const tags = search.tags?.split(',') ?? [];
  const shown = scenes.filter(
    (s) =>
      v.output in s.images &&
      (!q || s.path.toLowerCase().includes(q) || s.title.toLowerCase().includes(q)) &&
      tags.every((t) => s.tags.includes(t)),
  );
  if (search.sort === 'psnr-asc' || search.sort === 'psnr-desc') {
    const dir = search.sort === 'psnr-asc' ? 1 : -1;
    // ponytail: scenes without metrics sort last; recomputed per render, memoize if suites reach 10k scenes
    return shown.toSorted((a, b) => {
      const [x, y] = [score(index, a, v), score(index, b, v)];
      return x === undefined ? (y === undefined ? 0 : 1) : y === undefined ? -1 : dir * (x - y);
    });
  }
  return shown.toSorted((a, b) => a.path.localeCompare(b.path));
}

export const formatMetric = (n: number | null | undefined, digits = 2) =>
  n === undefined ? '–' : n === null ? '∞' : n.toFixed(digits);

/** Colour by PSNR: <25 dB red, <35 amber, else green; identical (null) is green. */
export function psnrClassName(m?: MetricsRecord): string {
  if (!m) return '';
  const p = m.psnr ?? Infinity;
  return p < 25 ? 'bg-red-500/15' : p < 35 ? 'bg-amber-500/15' : 'bg-green-500/15';
}
