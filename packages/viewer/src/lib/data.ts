import type { GroupNode, SceneNode, SuiteIndex } from 'fidelity-kit';

function* allScenes(g: GroupNode): Generator<SceneNode> {
  yield* g.scenes;
  for (const c of g.groups) yield* allScenes(c);
}

const dataPath = (rel: string) => `data/${rel.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`;

/**
 * `{ "<rel path>": "<hash>" }` of the image hashes the server knows right now (`serve` mode). Best-effort: a 404 (dev
 * mode, static hosts), an HTML fallback page or any error just means plain, unversioned image URLs.
 */
async function getHashes(): Promise<Record<string, string>> {
  try {
    const res = await fetch('data/image-hashes.json');
    const json: unknown = res.ok ? await res.json() : null;
    return json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Each scene's node plus its metrics records (keyed `<scene>/<output>/<file>`) as one comparable string. */
function sceneSnapshots(index: SuiteIndex, scenes: SceneNode[]) {
  const parts = new Map(scenes.map((s) => [s.path, [JSON.stringify(s)]]));
  for (const [key, metrics] of Object.entries(index.metrics))
    parts.get(key.split('/').slice(0, -2).join('/'))?.push(key, JSON.stringify(metrics));
  return new Map([...parts].map(([path, p]) => [path, p.join('\n')]));
}

let previous: { index: SuiteIndex; snapshots: Map<string, string> } | undefined;
let tick = 0;
/** scene path -> version, in the `hashes` map: `?v=` on all of a changed scene's images makes the browser refetch them. */
const sceneVersions: Record<string, string> = {};

/** Bumps the version of every scene whose JSON changed since the last load, or of all of them if the config did. */
function bumpChangedScenes(index: SuiteIndex, scenes: SceneNode[]) {
  const snapshots = sceneSnapshots(index, scenes);
  if (previous) {
    const configChanged = JSON.stringify(previous.index.config) !== JSON.stringify(index.config);
    for (const [path, snapshot] of snapshots)
      if (configChanged || previous.snapshots.get(path) !== snapshot) sceneVersions[path] = String(++tick);
  }
  previous = { index, snapshots };
}

/**
 * index.json (from `fidelity-kit process`) plus a flat scene list and image hashes. Loaded by the root route, and again
 * on every live update, which is when changed scenes get new image versions.
 */
export async function getSuite() {
  const [res, hashes] = await Promise.all([fetch('data/index.json'), getHashes()]);
  if (!res.ok) throw new Error('No index.json found. Run `fidelity-kit process <root>` first.');
  const index: SuiteIndex = await res.json();
  const scenes = [...allScenes(index.root)];
  bumpChangedScenes(index, scenes);
  const eventsUrl = res.headers.get('X-Fidelity-Events');
  const revision = res.headers.get('X-Fidelity-Revision');
  const liveReload = eventsUrl && revision ? { eventsUrl, revision } : null;
  return { index, hashes: { ...hashes, ...sceneVersions }, scenes, liveReload };
}

/** README.md of the suite ('' path) or a group/scene; null when absent (dev servers answer 404s with index.html). */
export async function getReadme(path: string): Promise<string | null> {
  const res = await fetch(`${dataPath(path)}${path ? '/' : ''}README.md`);
  return res.ok && !res.headers.get('content-type')?.includes('html') ? res.text() : null;
}

/** Optional homepage preamble from the suite README.md. */
export async function getPreamble(): Promise<string | null> {
  try {
    return await getReadme('');
  } catch {
    return null;
  }
}
