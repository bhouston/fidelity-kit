import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import pLimit from 'p-limit';
import { compareImages, type ImageMetrics } from './compare.js';
import { allScenes, scanSuite, type Suite } from './scan.js';
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
      const dir = join(root, scene.path, output);
      for (const ref of refs.filter((r) => renderers.includes(r))) {
        for (const r of renderers.filter((x) => x !== ref)) {
          total++;
          report();
          tasks.push(
            limit(async () => {
              try {
                const [refPath, testPath] = [join(dir, imageFile(ref)), join(dir, imageFile(r))];
                const metricsPath = join(dir, metricsFile(r, ref));
                const metricsRel = `${scene.path}/${output}/${metricsFile(r, ref)}`;
                const deltaPath = join(dir, deltaFile(r, ref));
                const inputs = Math.max(await mtime(refPath), await mtime(testPath));
                const outputs = [metricsPath, ...(suite.config.delta ? [deltaPath] : [])];
                const oldest = Math.min(...(await Promise.all(outputs.map(mtime))));
                if (!opts.force && oldest > inputs) {
                  result.skipped += 1;
                  validMetrics.add(metricsRel);
                  return;
                }
                try {
                  const { metrics, width, height, deltaImage } = await compareImages(refPath, testPath);
                  const rec: MetricsRecord = { ...metrics, width, height, generatedAt: new Date().toISOString() };
                  await writeFile(metricsPath, JSON.stringify(rec, null, 2) + '\n');
                  if (suite.config.delta) await writeFile(deltaPath, deltaImage);
                  result.computed += 1;
                  validMetrics.add(metricsRel);
                  opts.onCompute?.(metricsPath);
                } catch (e) {
                  result.failed.push({ file: testPath, error: e instanceof Error ? e.message : String(e) });
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
