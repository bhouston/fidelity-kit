import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { imageFile, IMAGE_EXTENSIONS } from './paths.js';
import { configSchema, sceneMetaSchema, type FidelityConfig } from './schema.js';
import type { ProgressCallback } from './progress.js';

export interface SceneNode {
  /** Slash-joined path from the root, e.g. `surfaces/standard_surface/brass`. */
  path: string;
  title: string;
  tags: string[];
  hasReadme: boolean;
  /** output id -> renderer ids that have an image */
  images: Record<string, string[]>;
  /** Selected source filenames by output and renderer; absent in legacy indexes. */
  imageFiles?: Record<string, Record<string, string>>;
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

/** Read each output directory once, then select the first supported format for each renderer. */
async function discoverImages(dir: string, config: FidelityConfig) {
  const images: Record<string, string[]> = {};
  const imageFiles: Record<string, Record<string, string>> = {};
  for (const output of config.outputs) {
    let entries;
    try {
      entries = await readdir(join(dir, output.id), { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) continue;
      throw error;
    }
    const files = new Set(
      entries.filter((entry) => entry.isFile() || entry.isSymbolicLink()).map((entry) => entry.name),
    );
    const selected: Record<string, string> = {};
    for (const renderer of config.renderers) {
      for (const extension of IMAGE_EXTENSIONS) {
        const file = imageFile(renderer.id, extension);
        if (!files.has(file) || !(await stat(join(dir, output.id, file)).catch(() => null))?.isFile()) continue;
        selected[renderer.id] = file;
        break;
      }
    }
    if (Object.keys(selected).length) {
      images[output.id] = Object.keys(selected);
      imageFiles[output.id] = selected;
    }
  }
  return { images, imageFiles };
}

/** A directory is a scene when it contains a configured source image or scene.json. */
export async function scanSuite(
  root: string,
  options: {
    config?: FidelityConfig;
    onScene?: (scene: SceneNode) => Promise<void>;
    onProgress?: ProgressCallback;
  } = {},
): Promise<Suite> {
  const config = options.config ?? (await readConfig(root));
  let completed = 0;
  let total = 1;
  const report = () => options.onProgress?.({ phase: 'Scanning', completed, total, unit: 'directories' });
  report();

  async function visit(rel: string): Promise<GroupNode | SceneNode | null> {
    try {
      return await visitDirectory(rel);
    } catch (error) {
      if (rel && isMissing(error)) return null;
      throw error;
    } finally {
      completed++;
      report();
    }
  }

  async function visitDirectory(rel: string): Promise<GroupNode | SceneNode | null> {
    const dir = join(root, rel);
    const { images, imageFiles } = await discoverImages(dir, config);
    const hasReadme = await exists(join(dir, 'README.md'));
    // scene.json also marks scenes whose renders are all missing or failed.
    if (rel && (Object.keys(images).length || (await exists(join(dir, 'scene.json'))))) {
      const meta = sceneMetaSchema.parse(
        (await exists(join(dir, 'scene.json'))) ? JSON.parse(await readFile(join(dir, 'scene.json'), 'utf8')) : {},
      );
      const scene = {
        path: rel,
        title: meta.title ?? rel.split('/').pop()!,
        tags: meta.tags,
        hasReadme,
        images,
        imageFiles,
      };
      await options.onScene?.(scene);
      return scene;
    }
    const group: GroupNode = { path: rel, hasReadme, groups: [], scenes: [] };
    const outputIds = new Set(config.outputs.map((o) => o.id));
    const children = (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !outputIds.has(e.name))
      .toSorted((a, b) => a.name.localeCompare(b.name));
    total += children.length;
    report();
    for (const e of children) {
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
  try {
    return await scanSceneDirectory(root, rel, config);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

function isMissing(error: unknown) {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

async function scanSceneDirectory(root: string, rel: string, config: FidelityConfig): Promise<SceneNode | null> {
  const dir = join(root, rel);
  if (!rel || !(await isDir(dir))) return null;
  const { images, imageFiles } = await discoverImages(dir, config);
  const metaFile = join(dir, 'scene.json');
  if (!Object.keys(images).length && !(await exists(metaFile))) return null;
  const meta = sceneMetaSchema.parse((await exists(metaFile)) ? JSON.parse(await readFile(metaFile, 'utf8')) : {});
  return {
    path: rel,
    title: meta.title ?? rel.split('/').pop()!,
    tags: meta.tags,
    hasReadme: await exists(join(dir, 'README.md')),
    images,
    imageFiles,
  };
}

export function* allScenes(g: GroupNode): Generator<SceneNode> {
  yield* g.scenes;
  for (const c of g.groups) yield* allScenes(c);
}
