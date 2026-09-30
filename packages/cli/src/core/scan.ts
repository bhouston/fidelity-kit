import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { imageFile } from './paths.js';
import { configSchema, sceneMetaSchema, type FidelityConfig } from './schema.js';

export interface SceneNode {
  /** Slash-joined path from the root, e.g. `surfaces/standard_surface/brass`. */
  path: string;
  title: string;
  tags: string[];
  hasReadme: boolean;
  /** output id -> renderer ids that have an image */
  images: Record<string, string[]>;
}
export interface GroupNode {
  path: string;
  hasReadme: boolean;
  groups: GroupNode[];
  scenes: SceneNode[];
}
export interface Suite {
  config: FidelityConfig;
  hasReadme: boolean;
  root: GroupNode;
}

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );
const isDir = (p: string) =>
  stat(p).then(
    (s) => s.isDirectory(),
    () => false,
  );

export async function readConfig(root: string): Promise<FidelityConfig> {
  return configSchema.parse(JSON.parse(await readFile(join(root, 'fidelity.json'), 'utf8')));
}

/** A directory is a scene when any `<output>/<renderer>.avif` exists in it; every other directory is a group. */
export async function scanSuite(root: string): Promise<Suite> {
  const config = await readConfig(root);
  const rendererIds = config.renderers.map((r) => r.id);

  async function visit(rel: string): Promise<GroupNode | SceneNode | null> {
    const dir = join(root, rel);
    const images: Record<string, string[]> = {};
    for (const o of config.outputs) {
      const found: string[] = [];
      for (const r of rendererIds) if (await exists(join(dir, o.id, imageFile(r)))) found.push(r);
      if (found.length) images[o.id] = found;
    }
    const hasReadme = await exists(join(dir, 'README.md'));
    // scene.json also marks scenes whose renders are all missing or failed.
    if (rel && (Object.keys(images).length || (await exists(join(dir, 'scene.json'))))) {
      const meta = sceneMetaSchema.parse(
        (await exists(join(dir, 'scene.json'))) ? JSON.parse(await readFile(join(dir, 'scene.json'), 'utf8')) : {},
      );
      return { path: rel, title: meta.title ?? rel.split('/').pop()!, tags: meta.tags, hasReadme, images };
    }
    const group: GroupNode = { path: rel, hasReadme, groups: [], scenes: [] };
    const outputIds = new Set(config.outputs.map((o) => o.id));
    for (const e of (await readdir(dir, { withFileTypes: true })).toSorted((a, b) => a.name.localeCompare(b.name))) {
      if (!e.isDirectory() || e.name.startsWith('.') || outputIds.has(e.name)) continue;
      const child = await visit(rel ? `${rel}/${e.name}` : e.name);
      if (!child) continue;
      if ('scenes' in child) group.groups.push(child);
      else group.scenes.push(child);
    }
    return group.groups.length || group.scenes.length ? group : null;
  }

  if (!(await isDir(root))) throw new Error(`Not a directory: ${root}`);
  const top = (await visit('')) ?? { path: '', hasReadme: false, groups: [], scenes: [] };
  return { config, hasReadme: await exists(join(root, 'README.md')), root: top as GroupNode };
}

/** Scan one known scene without walking the rest of the suite. */
export async function scanScene(root: string, rel: string, config: FidelityConfig): Promise<SceneNode | null> {
  const dir = join(root, rel);
  if (!rel || !(await isDir(dir))) return null;
  const images: Record<string, string[]> = {};
  for (const output of config.outputs) {
    const found: string[] = [];
    for (const renderer of config.renderers) {
      if (await exists(join(dir, output.id, imageFile(renderer.id)))) found.push(renderer.id);
    }
    if (found.length) images[output.id] = found;
  }
  const metaFile = join(dir, 'scene.json');
  if (!Object.keys(images).length && !(await exists(metaFile))) return null;
  const meta = sceneMetaSchema.parse((await exists(metaFile)) ? JSON.parse(await readFile(metaFile, 'utf8')) : {});
  return {
    path: rel,
    title: meta.title ?? rel.split('/').pop()!,
    tags: meta.tags,
    hasReadme: await exists(join(dir, 'README.md')),
    images,
  };
}

export function* allScenes(g: GroupNode): Generator<SceneNode> {
  yield* g.scenes;
  for (const c of g.groups) yield* allScenes(c);
}
