import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import pLimit from 'p-limit';
import { compareImages, type ImageMetrics } from './compare.js';
import { allScenes, scanScene, scanSuite, type GroupNode, type SceneNode, type Suite } from './scan.js';
import { deltaFile, imageFile, metricsFile } from './paths.js';
import type { ProgressCallback } from './progress.js';

export interface MetricsRecord extends ImageMetrics {
  width: number;
  height: number;
  generatedAt: string;
}

const mtime = (p: string) =>
  stat(p).then(
    (s) => s.mtimeMs,
    () => 0,
  );

export type SuiteIndex = Suite & { metrics: Record<string, MetricsRecord> };

export interface ProcessResult {
  computed: number;
  skipped: number;
  failed: { file: string; error: string }[];
}

async function processPair(
  root: string,
  scene: SceneNode,
  output: string,
  renderer: string,
  ref: string,
  delta: boolean,
  result: ProcessResult,
  force = false,
  onCompute?: (file: string) => void,
) {
  const dir = join(root, scene.path, output);
  const [refPath, testPath] = [join(dir, imageFile(ref)), join(dir, imageFile(renderer))];
  const metricsPath = join(dir, metricsFile(renderer, ref));
  const deltaPath = join(dir, deltaFile(renderer, ref));
  const inputs = Math.max(await mtime(refPath), await mtime(testPath));
  const outputs = [metricsPath, ...(delta ? [deltaPath] : [])];
  const oldest = Math.min(...(await Promise.all(outputs.map(mtime))));
  if (!force && oldest > inputs) {
    try {
      const record = JSON.parse(await readFile(metricsPath, 'utf8')) as MetricsRecord;
      result.skipped++;
      return record;
    } catch {
      /* recompute invalid metrics */
    }
  }
  try {
    const { metrics, width, height, deltaImage } = await compareImages(refPath, testPath);
    const rec: MetricsRecord = { ...metrics, width, height, generatedAt: new Date().toISOString() };
    await writeFile(metricsPath, JSON.stringify(rec, null, 2) + '\n');
    if (delta) await writeFile(deltaPath, deltaImage);
    result.computed++;
    onCompute?.(metricsPath);
    return rec;
  } catch (e) {
    result.failed.push({ file: testPath, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/** Writes metrics + delta for every (scene, output, reference, renderer) pair whose outputs are older than either input, then `index.json`. */
export async function processSuite(
  root: string,
  opts: {
    force?: boolean;
    concurrency?: number;
    onCompute?: (file: string) => void;
    onProgress?: ProgressCallback;
  } = {},
): Promise<ProcessResult> {
  const suite = await scanSuite(root, opts.onProgress);
  const refs = suite.config.renderers.filter((r) => r.reference).map((r) => r.id);
  const result: ProcessResult = { computed: 0, skipped: 0, failed: [] };
  const validMetrics = new Set<string>();
  const limit = pLimit(Math.max(1, opts.concurrency ?? availableParallelism()));
  const tasks: Promise<void>[] = [];
  let completed = 0;
  let total = 0;
  const report = () => opts.onProgress?.({ phase: 'Comparing', completed, total, unit: 'pairs' });
  report();

  for (const scene of allScenes(suite.root)) {
    for (const [output, renderers] of Object.entries(scene.images)) {
      for (const ref of refs.filter((r) => renderers.includes(r))) {
        for (const r of renderers.filter((x) => x !== ref)) {
          total++;
          report();
          tasks.push(
            limit(async () => {
              try {
                const metricsRel = `${scene.path}/${output}/${metricsFile(r, ref)}`;
                if (
                  await processPair(root, scene, output, r, ref, suite.config.delta, result, opts.force, opts.onCompute)
                ) {
                  validMetrics.add(metricsRel);
                }
              } finally {
                completed++;
                report();
              }
            }),
          );
        }
      }
    }
  }

  await Promise.all(tasks);
  result.failed.sort((a, b) => a.file.localeCompare(b.file)); // deterministic regardless of completion order
  const indexedSuite = await scanSuite(root, (status) => opts.onProgress?.({ ...status, phase: 'Scanning for index' }));
  await writeIndex(root, indexedSuite, validMetrics, opts.onProgress);
  return result;
}

function replaceScene(root: GroupNode, path: string, scene: SceneNode | null) {
  const parts = path.split('/');
  const parents: GroupNode[] = [root];
  let group = root;
  for (const part of parts.slice(0, -1)) {
    const groupPath = group.path ? `${group.path}/${part}` : part;
    let child = group.groups.find((g) => g.path === groupPath);
    if (!child && scene) {
      child = { path: groupPath, hasReadme: false, groups: [], scenes: [] };
      group.groups.push(child);
      group.groups.sort((a, b) => a.path.localeCompare(b.path));
    }
    if (!child) return;
    group = child;
    parents.push(group);
  }
  group.scenes = group.scenes.filter((s) => s.path !== path);
  if (scene) group.scenes.push(scene);
  group.scenes.sort((a, b) => a.path.localeCompare(b.path));
  for (let i = parents.length - 1; i > 0; i--) {
    const current = parents[i]!;
    if (current.groups.length || current.scenes.length) break;
    parents[i - 1]!.groups = parents[i - 1]!.groups.filter((g) => g !== current);
  }
}

/** Update only scenes and pairs touched by image or scene metadata changes. Config changes use a full pass. */
export async function processChanges(
  root: string,
  paths: Iterable<string>,
  onProgress?: ProgressCallback,
): Promise<ProcessResult> {
  const changed = [...paths];
  if (changed.includes('fidelity.json')) return processSuite(root, { onProgress });
  let index: SuiteIndex;
  try {
    index = JSON.parse(await readFile(join(root, 'index.json'), 'utf8')) as SuiteIndex;
  } catch {
    return processSuite(root, { onProgress });
  }
  const result: ProcessResult = { computed: 0, skipped: 0, failed: [] };
  const scenes = new Map<string, Map<string, Set<string>>>();
  for (const path of changed) {
    const parts = path.split('/');
    const file = parts.pop()!;
    if (file === 'scene.json' && parts.length) {
      const rel = parts.join('/');
      if (!scenes.has(rel)) scenes.set(rel, new Map());
    } else if (file.endsWith('.avif') && !file.includes('.vs-') && parts.length >= 2) {
      const output = parts.pop()!;
      const renderer = file.slice(0, -5);
      if (!index.config.outputs.some((o) => o.id === output) || !index.config.renderers.some((r) => r.id === renderer))
        continue;
      const rel = parts.join('/');
      if (!scenes.has(rel)) scenes.set(rel, new Map());
      const outputs = scenes.get(rel)!;
      if (!outputs.has(output)) outputs.set(output, new Set());
      outputs.get(output)!.add(renderer);
    }
  }
  let scanned = 0;
  let compared = 0;
  let totalPairs = 0;
  const scanProgress = () =>
    onProgress?.({ phase: 'Scanning changes', completed: scanned, total: scenes.size, unit: 'scenes' });
  const compareProgress = () =>
    onProgress?.({ phase: 'Comparing', completed: compared, total: totalPairs, unit: 'pairs' });
  scanProgress();
  for (const [rel, outputs] of scenes) {
    const scene = await scanScene(root, rel, index.config);
    scanned++;
    scanProgress();
    replaceScene(index.root, rel, scene);
    const valid = new Set<string>();
    if (scene) {
      for (const [output, renderers] of Object.entries(scene.images)) {
        for (const ref of index.config.renderers.filter((r) => r.reference && renderers.includes(r.id))) {
          for (const renderer of renderers.filter((r) => r !== ref.id)) {
            valid.add(`${rel}/${output}/${metricsFile(renderer, ref.id)}`);
          }
        }
      }
    }
    for (const key of Object.keys(index.metrics)) {
      if (key.startsWith(`${rel}/`) && !valid.has(key)) delete index.metrics[key];
    }
    if (!scene) continue;
    for (const [output, touched] of outputs) {
      const renderers = scene.images[output] ?? [];
      for (const ref of index.config.renderers.filter((r) => r.reference && renderers.includes(r.id))) {
        for (const renderer of renderers.filter((r) => r !== ref.id && (touched.has(r) || touched.has(ref.id)))) {
          totalPairs++;
          compareProgress();
          const key = `${rel}/${output}/${metricsFile(renderer, ref.id)}`;
          const rec = await processPair(root, scene, output, renderer, ref.id, index.config.delta, result);
          if (rec) index.metrics[key] = rec;
          else delete index.metrics[key];
          compared++;
          compareProgress();
        }
      }
    }
  }
  if (scenes.size) {
    onProgress?.({ phase: 'Writing index', completed: 0, total: 1, unit: 'files' });
    const file = join(root, 'index.json');
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(index, null, 2) + '\n');
    await rename(tmp, file);
    onProgress?.({ phase: 'Writing index', completed: 1, total: 1, unit: 'files' });
  }
  return result;
}

/** `index.json`: the scan plus metrics for successful or up-to-date pairs, so the viewer never walks the disk per request. */
async function writeIndex(root: string, suite: Suite, validMetrics: Set<string>, onProgress?: ProgressCallback) {
  const metrics: SuiteIndex['metrics'] = {};
  let completed = 0;
  const report = () =>
    onProgress?.({ phase: 'Writing index', completed, total: validMetrics.size + 1, unit: 'entries' });
  report();
  for (const scene of allScenes(suite.root)) {
    for (const [output, renderers] of Object.entries(scene.images)) {
      for (const r of renderers) {
        for (const ref of suite.config.renderers.filter((x) => x.reference)) {
          const rel = `${scene.path}/${output}/${metricsFile(r, ref.id)}`;
          if (!validMetrics.has(rel)) continue;
          const raw = await readFile(join(root, rel), 'utf8').catch(() => null);
          if (raw) metrics[rel] = JSON.parse(raw);
          completed++;
          report();
        }
      }
    }
  }
  const file = join(root, 'index.json');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ ...suite, metrics }, null, 2) + '\n');
  completed++;
  report();
}
