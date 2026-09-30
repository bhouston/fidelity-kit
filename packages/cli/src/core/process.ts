import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { compareImages, type ImageMetrics } from './compare.js';
import { allScenes, scanSuite, type Suite } from './scan.js';
import { deltaFile, imageFile, metricsFile } from './paths.js';

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
  opts: { force?: boolean; onCompute?: (file: string) => void } = {},
): Promise<ProcessResult> {
  const suite = await scanSuite(root);
  const refs = suite.config.renderers.filter((r) => r.reference).map((r) => r.id);
  const result: ProcessResult = { computed: 0, skipped: 0, failed: [] };

  for (const scene of allScenes(suite.root)) {
    for (const [output, renderers] of Object.entries(scene.images)) {
      const dir = join(root, scene.path, output);
      for (const ref of refs.filter((r) => renderers.includes(r))) {
        for (const r of renderers.filter((x) => x !== ref)) {
          const [refPath, testPath] = [join(dir, imageFile(ref)), join(dir, imageFile(r))];
          const metricsPath = join(dir, metricsFile(r, ref));
          const deltaPath = join(dir, deltaFile(r, ref));
          const inputs = Math.max(await mtime(refPath), await mtime(testPath));
          const outputs = [metricsPath, ...(suite.config.delta ? [deltaPath] : [])];
          const oldest = Math.min(...(await Promise.all(outputs.map(mtime))));
          if (!opts.force && oldest > inputs) {
            result.skipped += 1;
            continue;
          }
          try {
            const { metrics, width, height, deltaImage } = await compareImages(refPath, testPath);
            const rec: MetricsRecord = { ...metrics, width, height, generatedAt: new Date().toISOString() };
            await writeFile(metricsPath, JSON.stringify(rec, null, 2) + '\n');
            if (suite.config.delta) await writeFile(deltaPath, deltaImage);
            result.computed += 1;
            opts.onCompute?.(metricsPath);
          } catch (e) {
            result.failed.push({ file: testPath, error: e instanceof Error ? e.message : String(e) });
          }
        }
      }
    }
  }

  await writeIndex(root, await scanSuite(root));
  return result;
}

/** `index.json`: the scan plus every metrics record, so the viewer never walks the disk per request. */
async function writeIndex(root: string, suite: Suite) {
  const metrics: SuiteIndex['metrics'] = {};
  for (const scene of allScenes(suite.root)) {
    for (const [output, renderers] of Object.entries(scene.images)) {
      for (const r of renderers) {
        for (const ref of suite.config.renderers.filter((x) => x.reference)) {
          const rel = `${scene.path}/${output}/${metricsFile(r, ref.id)}`;
          const raw = await readFile(join(root, rel), 'utf8').catch(() => null);
          if (raw) metrics[rel] = JSON.parse(raw);
        }
      }
    }
  }
  const file = join(root, 'index.json');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ ...suite, metrics }, null, 2) + '\n');
}
