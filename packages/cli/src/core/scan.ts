import { readdir, readFile, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import { imageFile, IMAGE_EXTENSIONS } from './paths.js';
import { parseConfig, parseSceneMeta, type FidelityConfig, type SuiteWarning } from './schema.js';
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

export type ScanWarningCallback = (warning: SuiteWarning) => void;

async function readJson(file: string, label: string) {
  const text = await readFile(file, 'utf8');
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`Invalid ${label}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

export async function readConfig(root: string, onWarning?: ScanWarningCallback): Promise<FidelityConfig> {
  const file = join(root, 'fidelity.json');
  if (!(await exists(file))) throw new Error(`No fidelity.json in ${root}`);
  return parseConfig(await readJson(file, 'fidelity.json'), 'fidelity.json', onWarning);
}

async function readSceneMeta(root: string, rel: string, onWarning?: ScanWarningCallback) {
  const file = join(root, rel, 'scene.json');
  const label = `${rel}/scene.json`;
  return parseSceneMeta((await exists(file)) ? await readJson(file, label) : {}, label, onWarning);
}

/** Extensions that look like renders, so misplaced or unsupported images can be reported. Others are left alone. */
const IMAGE_LIKE = /\.(avif|webp|png|jpe?g|gif|bmp|tiff?|exr|hdr|heic|jxl)$/i;
/** Metrics, deltas, cache sidecars, and temporary files written by `process`. */
const isGenerated = (file: string) => file.includes('.vs-') || file.endsWith('.tmp');
const joinRel = (...parts: string[]) => parts.filter(Boolean).join('/');
const isFileEntry = (entry: Dirent) => entry.isFile() || entry.isSymbolicLink();

/** `<renderer>.<supported extension>` names, which only take effect inside a declared output folder. */
function rendererImage(file: string, config: FidelityConfig) {
  return config.renderers.some((r) => IMAGE_EXTENSIONS.some((ext) => imageFile(r.id, ext) === file));
}

function rendererHint(stem: string, config: FidelityConfig) {
  const match = config.renderers.find((r) => r.id.toLowerCase() === stem.toLowerCase());
  return match ? ` (did you mean "${match.id}"?)` : '';
}

/** Read each output directory once, then select the first supported format for each renderer. */
async function discoverImages(root: string, rel: string, config: FidelityConfig, onWarning?: ScanWarningCallback) {
  const dir = join(root, rel);
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
    const files = new Set(entries.filter(isFileEntry).map((entry) => entry.name));
    const selected: Record<string, string> = {};
    for (const renderer of config.renderers) {
      for (const extension of IMAGE_EXTENSIONS) {
        const file = imageFile(renderer.id, extension);
        if (!files.has(file) || !(await stat(join(dir, output.id, file)).catch(() => null))?.isFile()) continue;
        selected[renderer.id] = file;
        break;
      }
    }
    if (onWarning) {
      const chosen = new Set(Object.values(selected));
      for (const file of [...files].toSorted()) {
        if (chosen.has(file) || file.startsWith('.') || isGenerated(file) || !IMAGE_LIKE.test(file)) continue;
        const dot = file.lastIndexOf('.');
        const stem = file.slice(0, dot);
        const renderer = config.renderers.find((r) => r.id === stem);
        const message = !IMAGE_EXTENSIONS.some((ext) => ext === file.slice(dot))
          ? `unsupported image format is ignored; use ${IMAGE_EXTENSIONS.join(', ')}`
          : renderer && selected[renderer.id]
            ? `ignored because ${selected[renderer.id]} takes precedence (${IMAGE_EXTENSIONS.join(' > ')})`
            : renderer
              ? 'image could not be read as a file and is ignored'
              : `"${stem}" is not a renderer in fidelity.json; image is ignored${rendererHint(stem, config)}`;
        onWarning({ path: joinRel(rel, output.id, file), message });
      }
    }
    if (Object.keys(selected).length) {
      images[output.id] = Object.keys(selected);
      imageFiles[output.id] = selected;
    }
  }
  return { images, imageFiles };
}

/** Renderer images placed directly in a scene, group, or undeclared output folder are never compared. */
function warnLooseImages(rel: string, entries: Dirent[], config: FidelityConfig, onWarning: ScanWarningCallback) {
  const outputs = config.outputs.map((o) => o.id).join(', ');
  for (const entry of entries)
    if (isFileEntry(entry) && rendererImage(entry.name, config))
      onWarning({
        path: joinRel(rel, entry.name),
        message: `renderer image is outside a declared output folder (${outputs}) and is ignored`,
      });
}

/** Scenes are leaves: report folders inside them that look like undeclared outputs or nested scenes. */
async function warnSceneContents(root: string, rel: string, config: FidelityConfig, onWarning: ScanWarningCallback) {
  const outputIds = new Set(config.outputs.map((o) => o.id));
  const entries = await readdir(join(root, rel), { withFileTypes: true });
  warnLooseImages(rel, entries, config, onWarning);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || outputIds.has(entry.name)) continue;
    const child = joinRel(rel, entry.name);
    const children = await readdir(join(root, child), { withFileTypes: true }).catch(() => []);
    warnLooseImages(child, children, config, onWarning);
    if (children.some((c) => c.isDirectory() && outputIds.has(c.name)))
      onWarning({
        path: child,
        message: `nested scene is ignored because "${rel}" is already a scene; move it beside its parent`,
      });
  }
}

/** A directory is a scene when it contains a configured source image or scene.json. */
export async function scanSuite(
  root: string,
  options: {
    config?: FidelityConfig;
    onScene?: (scene: SceneNode) => Promise<void>;
    onProgress?: ProgressCallback;
    /** Files and folders that look like suite content but are ignored. */
    onWarning?: ScanWarningCallback;
  } = {},
): Promise<Suite> {
  const { onWarning } = options;
  const config = options.config ?? (await readConfig(root, onWarning));
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
    // The root is never a scene, so its output-named folders are reported below rather than read.
    const { images, imageFiles } = rel
      ? await discoverImages(root, rel, config, onWarning)
      : { images: {}, imageFiles: {} };
    const hasReadme = await exists(join(dir, 'README.md'));
    // scene.json also marks scenes whose renders are all missing or failed.
    if (rel && (Object.keys(images).length || (await exists(join(dir, 'scene.json'))))) {
      const meta = await readSceneMeta(root, rel, onWarning);
      if (onWarning) await warnSceneContents(root, rel, config, onWarning);
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
    const entries = await readdir(dir, { withFileTypes: true });
    if (onWarning) {
      warnLooseImages(rel, entries, config, onWarning);
      if (!rel)
        for (const e of entries)
          if (e.isDirectory() && outputIds.has(e.name))
            onWarning({
              path: e.name,
              message: `output folder at the results root is ignored; put it inside a scene folder (e.g. my-scene/${e.name})`,
            });
    }
    const children = entries
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
export async function scanScene(
  root: string,
  rel: string,
  config: FidelityConfig,
  onWarning?: ScanWarningCallback,
): Promise<SceneNode | null> {
  try {
    return await scanSceneDirectory(root, rel, config, onWarning);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

function isMissing(error: unknown) {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

async function scanSceneDirectory(
  root: string,
  rel: string,
  config: FidelityConfig,
  onWarning?: ScanWarningCallback,
): Promise<SceneNode | null> {
  const dir = join(root, rel);
  if (!rel || !(await isDir(dir))) return null;
  const { images, imageFiles } = await discoverImages(root, rel, config, onWarning);
  if (!Object.keys(images).length && !(await exists(join(dir, 'scene.json')))) return null;
  const meta = await readSceneMeta(root, rel, onWarning);
  if (onWarning) await warnSceneContents(root, rel, config, onWarning);
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
