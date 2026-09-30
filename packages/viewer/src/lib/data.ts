import type { GroupNode, SceneNode, SuiteIndex } from 'fidelity-kit';

function* allScenes(g: GroupNode): Generator<SceneNode> {
  yield* g.scenes;
  for (const c of g.groups) yield* allScenes(c);
}

const dataPath = (rel: string) => `data/${rel.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`;

/** index.json (from `fidelity-kit process`) plus a flat scene list. Loaded once by the root route. */
export async function getSuite() {
  const res = await fetch('data/index.json');
  if (!res.ok) throw new Error('No index.json found. Run `fidelity-kit process <root>` first.');
  const index: SuiteIndex = await res.json();
  return { index, scenes: [...allScenes(index.root)] };
}

/** README.md of the suite ('' path) or a group/scene; null when absent (dev servers answer 404s with index.html). */
export async function getReadme(path: string): Promise<string | null> {
  const res = await fetch(`${dataPath(path)}${path ? '/' : ''}README.md`);
  return res.ok && !res.headers.get('content-type')?.includes('html') ? res.text() : null;
}
