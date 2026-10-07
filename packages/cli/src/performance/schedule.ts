import { selectNames } from '../select.js';
import type { Entry, Suite } from '../schema/index.js';
export interface ScheduledRun {
  entry: Entry;
}
export function scheduleSuite(
  suite: Suite,
  options: { renderer?: string[]; scene?: string[]; renderers?: string; scenes?: string; seed?: number } = {},
): ScheduledRun[] {
  if (options.seed !== undefined && !Number.isFinite(options.seed)) throw new Error('seed must be finite');
  const rendererNames = [...new Set(suite.entries.map((entry) => entry.renderer.id))];
  const sceneNames = [...new Set(suite.entries.map((entry) => entry.scene.id))];
  const rendererIds = options.renderer?.length
    ? selectNames(rendererNames, options.renderer.join(','), 'renderer')
    : undefined;
  const sceneIds = options.scene?.length ? selectNames(sceneNames, options.scene.join(','), 'scene') : undefined;
  const rendererGlobs =
    options.renderers === undefined ? undefined : selectNames(rendererNames, options.renderers, 'renderer');
  const sceneGlobs = options.scenes === undefined ? undefined : selectNames(sceneNames, options.scenes, 'scene');
  const entries = suite.entries.filter(
    (entry) =>
      (!rendererIds || rendererIds.includes(entry.renderer.id)) &&
      (!sceneIds || sceneIds.includes(entry.scene.id)) &&
      (!rendererGlobs || rendererGlobs.includes(entry.renderer.id)) &&
      (!sceneGlobs || sceneGlobs.includes(entry.scene.id)),
  );
  let state = options.seed ?? 1;
  const shuffle = (values: Entry[]) => {
    if (options.seed === undefined) return values;
    for (let i = values.length - 1; i > 0; i--) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const j = state % (i + 1);
      [values[i], values[j]] = [values[j]!, values[i]!];
    }
    return values;
  };
  const identities = new Set<string>();
  for (const entry of suite.entries) {
    const identity = entry.renderer.id + '/' + entry.scene.id;
    if (identities.has(identity)) throw new Error(`Duplicate renderer/scene workload: ${identity}`);
    identities.add(identity);
  }
  return shuffle([...entries]).map((entry) => ({ entry }));
}
export const chromeFlags = (vsync: 'on' | 'off') => [
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--enable-unsafe-webgpu',
  '--enable-webgpu-developer-features',
  '--site-per-process',
  ...(vsync === 'off' ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : []),
];
export function isSoftwareAdapter(adapter: unknown): boolean {
  return /swiftshader|llvmpipe|softpipe|software rasterizer|microsoft basic render/i.test(JSON.stringify(adapter));
}
