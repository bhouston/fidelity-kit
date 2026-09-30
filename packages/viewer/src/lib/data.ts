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

/** index.json (from `fidelity-kit process`) plus a flat scene list and image hashes. Loaded once by the root route. */
export async function getSuite() {
  const [res, hashes] = await Promise.all([fetch('data/index.json'), getHashes()]);
  if (!res.ok) throw new Error('No index.json found. Run `fidelity-kit process <root>` first.');
  const index: SuiteIndex = await res.json();
  return { index, hashes, scenes: [...allScenes(index.root)] };
}

/** README.md of the suite ('' path) or a group/scene; null when absent (dev servers answer 404s with index.html). */
export async function getReadme(path: string): Promise<string | null> {
  const res = await fetch(`${dataPath(path)}${path ? '/' : ''}README.md`);
  return res.ok && !res.headers.get('content-type')?.includes('html') ? res.text() : null;
}
