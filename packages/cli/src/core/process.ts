import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import pLimit from 'p-limit';
import { compareImages, measureImages, type ImageMetrics } from './compare.js';
import { readConfig, scanScene, scanSuite, type GroupNode, type SceneNode, type Suite } from './scan.js';
import { deltaFile, imageFile, IMAGE_EXTENSIONS, isImageFile, metricsFile } from './paths.js';
import type { FidelityConfig } from './schema.js';
import type { ProgressCallback } from './progress.js';

export interface MetricsRecord extends ImageMetrics {
  width: number;
  height: number;
  generatedAt: string;
  /** Present in the viewer index; legacy entries refer to AVIF heatmaps. */
  deltaFile?: string;
}
export type SuiteIndex = Suite & { metrics: Record<string, MetricsRecord> };
export interface ProcessResult {
  computed: number;
  skipped: number;
  failed: { file: string; error: string }[];
}
export interface ProcessOptions {
  force?: boolean;
  concurrency?: number;
  onCompute?: (file: string) => void;
  onProgress?: ProgressCallback;
}
interface Signature {
  mtimeMs: number;
  size: number;
}
interface Inputs {
  reference: Signature & { path: string };
  renderer: Signature & { path: string };
}
interface Pair {
  key: string;
  scene: string;
  reference: string;
  renderer: string;
  delta: string;
  inputs: Inputs;
  attempted?: string;
  running: boolean;
  force: boolean;
}
interface SceneState {
  node: SceneNode;
  pairs: Map<string, Pair>;
}
const emptyResult = (): ProcessResult => ({ computed: 0, skipped: 0, failed: [] });
const signatureKey = (inputs: Inputs | null) => JSON.stringify(inputs);

async function signature(path: string): Promise<Signature | null> {
  try {
    const s = await stat(path);
    return s.isFile() ? { mtimeMs: s.mtimeMs, size: s.size } : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR')
      return null;
    throw error;
  }
}
/** Version 1 AVIF metrics predate explicit source filenames and independent delta records. */
function matchesSource(saved: unknown, inputs: Inputs): boolean {
  if (!saved || typeof saved !== 'object') return false;
  const source = saved as {
    version?: number;
    reference?: Partial<Inputs['reference']>;
    renderer?: Partial<Inputs['renderer']>;
  };
  return (
    source.version === 1 &&
    (['reference', 'renderer'] as const).every((side) => {
      const previous = source[side];
      const current = inputs[side];
      return (
        previous?.size === current.size &&
        previous.mtimeMs === current.mtimeMs &&
        (previous.path === current.path || (previous.path === undefined && current.path.endsWith('.avif')))
      );
    })
  );
}

function validMetrics(value: unknown): value is MetricsRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as MetricsRecord;
  return (
    (r.psnr === null || Number.isFinite(r.psnr)) &&
    Number.isInteger(r.width) &&
    r.width > 0 &&
    Number.isInteger(r.height) &&
    r.height > 0 &&
    typeof r.generatedAt === 'string'
  );
}
async function atomicWrite(file: string, data: string | Buffer) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, file);
  } finally {
    await rm(tmp, { force: true });
  }
}

/** A fixed configuration, small per-scene dependency maps, and one bounded comparison queue. */
export class SuiteProcessor {
  readonly config: FidelityConfig;
  private suite: Suite;
  private scenes = new Map<string, SceneState>();
  private metrics: SuiteIndex['metrics'] = {};
  private pending = new Set<string>();
  private unsettled = new Set<string>();
  private epochs = new Map<string, number>();
  private dirty = new Set<Pair>();
  private active = new Set<Promise<void>>();
  private limit: ReturnType<typeof pLimit>;
  private concurrency: number;
  private result = emptyResult();
  private flushing?: Promise<ProcessResult>;
  private force: boolean;
  private indexDirty = false;
  private progressCompleted = 0;
  private progressTotal = 0;

  private reportComparing() {
    this.opts.onProgress?.({
      phase: 'Comparing',
      completed: this.progressCompleted,
      total: this.progressTotal,
      unit: 'pairs',
    });
  }

  private constructor(
    readonly root: string,
    config: FidelityConfig,
    private opts: ProcessOptions,
  ) {
    this.config = config;
    this.suite = { config, hasReadme: false, root: { path: '', hasReadme: false, groups: [], scenes: [] } };
    this.concurrency = opts.concurrency ?? availableParallelism();
    if (!Number.isInteger(this.concurrency) || this.concurrency < 1)
      throw new Error('Concurrency must be a positive integer');
    this.limit = pLimit(this.concurrency);
    this.force = opts.force ?? false;
  }

  static async create(root: string, opts: ProcessOptions = {}) {
    return new SuiteProcessor(root, await readConfig(root), opts);
  }

  /** Only source inputs qualify. Generated deltas, metrics, index and temporary files never do. */
  sceneForInput(path: string): string | null {
    const parts = path.split('/');
    if (parts.some((p) => !p || p.startsWith('.'))) return null;
    const file = parts.pop()!;
    if (file === 'scene.json' && parts.length) return parts.join('/');
    if (file === 'README.md') return parts.join('/');
    if (file.includes('.vs-') && IMAGE_EXTENSIONS.some((ext) => file.endsWith(`.delta${ext}`))) return null;
    const output = parts.pop();
    if (!parts.length || !this.config.outputs.some((o) => o.id === output)) return null;
    if (
      !isImageFile(file) ||
      !this.config.renderers.some((r) => IMAGE_EXTENSIONS.some((ext) => imageFile(r.id, ext) === file))
    )
      return null;
    return parts.join('/');
  }

  /** Invalidate synchronously, including work already running; reconciliation happens at the batch boundary. */
  notify(paths: Iterable<string>, defer = false) {
    for (const path of paths) {
      const scene = this.sceneForInput(path);
      if (scene === null) continue;
      (defer ? this.unsettled : this.pending).add(scene);
      this.epochs.set(scene, (this.epochs.get(scene) ?? 0) + 1);
    }
  }

  /** Release one coalesced watcher batch without delaying invalidation of running work. */
  settle() {
    for (const scene of this.unsettled) this.pending.add(scene);
    this.unsettled.clear();
  }

  get needsFlush() {
    return !!(this.pending.size || this.active.size || this.indexDirty);
  }

  removeDirectory(path: string, defer = false) {
    for (const scene of this.scenes.keys()) {
      if (scene === path || scene.startsWith(`${path}/`) || path.startsWith(`${scene}/`)) {
        (defer ? this.unsettled : this.pending).add(scene);
        this.epochs.set(scene, (this.epochs.get(scene) ?? 0) + 1);
      }
    }
  }

  /** Comparisons start as scenes are discovered; no second walk or metrics reread is needed. */
  async initialize(process = true): Promise<ProcessResult> {
    if (!process) {
      const index = JSON.parse(await readFile(join(this.root, 'index.json'), 'utf8')) as SuiteIndex;
      this.metrics = index.metrics;
    }
    try {
      this.suite = await scanSuite(this.root, {
        config: this.config,
        onProgress: this.opts.onProgress,
        onScene: async (scene) => {
          await this.reconcile(scene.path, scene, process);
        },
      });
    } catch (error) {
      this.dirty.clear();
      await Promise.all(this.active);
      throw error;
    }
    if (!process) {
      const valid = new Set([...this.scenes.values()].flatMap((scene) => [...scene.pairs.keys()]));
      for (const key of Object.keys(this.metrics)) if (!valid.has(key)) delete this.metrics[key];
    }
    this.indexDirty = process;
    // Events collected during discovery are reconciled even when the initial processing was disabled.
    return this.flush();
  }

  flush(): Promise<ProcessResult> {
    if (!this.flushing)
      this.flushing = this.drain().finally(() => {
        this.flushing = undefined;
      });
    return this.flushing;
  }

  private async reconcile(rel: string, node: SceneNode | null, process = true) {
    const old = this.scenes.get(rel);
    const pairs = new Map<string, Pair>();
    if (node) {
      for (const [output, renderers] of Object.entries(node.images)) {
        const images = new Map(
          await Promise.all(
            renderers.map(async (r) => {
              const path = `${rel}/${output}/${node.imageFiles?.[output]?.[r] ?? imageFile(r)}`;
              return [r, { path, signature: await signature(join(this.root, path)) }] as const;
            }),
          ),
        );
        for (const ref of this.config.renderers.filter((r) => r.reference && images.has(r.id))) {
          for (const renderer of renderers.filter((r) => r !== ref.id)) {
            const a = images.get(ref.id)!;
            const b = images.get(renderer)!;
            if (!a.signature || !b.signature) continue;
            const key = `${rel}/${output}/${metricsFile(renderer, ref.id)}`;
            const inputs = { reference: { ...a.signature, path: a.path }, renderer: { ...b.signature, path: b.path } };
            const pair = old?.pairs.get(key) ?? {
              key,
              scene: rel,
              reference: a.path,
              renderer: b.path,
              delta: `${rel}/${output}/${deltaFile(renderer, ref.id)}`,
              inputs,
              running: false,
              force: this.force,
            };
            if (signatureKey(pair.inputs) !== signatureKey(inputs)) {
              pair.inputs = inputs;
              pair.reference = a.path;
              pair.renderer = b.path;
              pair.attempted = undefined;
              delete this.metrics[key];
            }
            pairs.set(key, pair);
          }
        }
      }
      this.scenes.set(rel, { node, pairs });
      // A completing task can pump the queue during any await above. Publish the entire scene
      // before making its pairs runnable, otherwise new pairs can be discarded as obsolete.
      if (process)
        for (const pair of pairs.values()) {
          if (pair.attempted === signatureKey(pair.inputs)) continue;
          if (!this.dirty.has(pair) && !pair.running) {
            this.progressTotal++;
            this.reportComparing();
          }
          this.dirty.add(pair);
        }
    } else {
      this.scenes.delete(rel);
      this.epochs.delete(rel);
    }
    for (const [key, pair] of old?.pairs ?? []) {
      if (!pairs.has(key)) {
        this.dirty.delete(pair);
        delete this.metrics[key];
      }
    }
    replaceScene(this.suite.root, rel, node);
    this.indexDirty = true;
    if (process) this.pump();
  }

  private current(pair: Pair, epoch: number) {
    return this.scenes.get(pair.scene)?.pairs.get(pair.key) === pair && (this.epochs.get(pair.scene) ?? 0) === epoch;
  }

  private pump() {
    for (const pair of this.dirty) {
      if (this.active.size >= this.concurrency) break;
      if (pair.running || this.unsettled.has(pair.scene)) continue;
      this.dirty.delete(pair);
      if (pair.attempted === signatureKey(pair.inputs)) continue;
      pair.running = true;
      const task = this.limit(() => this.processPair(pair)).finally(() => {
        this.progressCompleted++;
        this.reportComparing();
        pair.running = false;
        this.active.delete(task);
        this.pump();
      });
      this.active.add(task);
    }
  }

  private async readInputs(pair: Pair): Promise<Inputs | null> {
    const [reference, renderer] = await Promise.all([
      signature(join(this.root, pair.reference)),
      signature(join(this.root, pair.renderer)),
    ]);
    return reference && renderer
      ? { reference: { ...reference, path: pair.reference }, renderer: { ...renderer, path: pair.renderer } }
      : null;
  }

  private async processPair(pair: Pair) {
    const epoch = this.epochs.get(pair.scene) ?? 0;
    const inputs = pair.inputs;
    const key = signatureKey(inputs);
    const metricsPath = join(this.root, pair.key);
    // Independent commit markers let either artifact be refreshed without rewriting the other.
    const source = { version: 1, ...inputs };
    const deltaPath = join(this.root, pair.delta);
    const deltaCachePath = `${deltaPath}.json`;
    const stillCurrent = async () => {
      const actual = await this.readInputs(pair);
      return this.current(pair, epoch) && signatureKey(actual) === key;
    };
    const retry = () => {
      if (this.scenes.get(pair.scene)?.pairs.get(pair.key) === pair) {
        pair.attempted = undefined;
        if (!this.unsettled.has(pair.scene)) this.pending.add(pair.scene);
        this.indexDirty = true;
        delete this.metrics[pair.key];
      }
    };
    try {
      if (!(await stillCurrent())) {
        retry();
        return;
      }
      let record: MetricsRecord | undefined;
      let cleanLegacyMetrics = false;
      let deltaCurrent = false;
      if (!pair.force) {
        try {
          const { source: saved, ...cached } = JSON.parse(await readFile(metricsPath, 'utf8'));
          if (matchesSource(saved, inputs) && validMetrics(cached)) {
            record = { psnr: cached.psnr, width: cached.width, height: cached.height, generatedAt: cached.generatedAt };
            cleanLegacyMetrics = ['rmse', 'mae', 'maxError'].some((field) => field in cached);
          }
        } catch {
          /* Missing or invalid metrics are recomputed independently of the delta. */
        }
        try {
          const saved = JSON.parse(await readFile(deltaCachePath, 'utf8'));
          deltaCurrent = matchesSource(saved, inputs) && !!(await signature(deltaPath));
        } catch {
          /* The delta has its own input signature and commit marker. */
        }
      }
      if (record && deltaCurrent) {
        if (!(await stillCurrent())) {
          retry();
          return;
        }
        this.result.skipped++;
      } else {
        const compare = deltaCurrent ? measureImages : compareImages;
        const compared: { metrics: ImageMetrics; width: number; height: number; deltaImage?: Buffer } = await compare(
          join(this.root, pair.reference),
          join(this.root, pair.renderer),
        );
        if (!(await stillCurrent())) {
          retry();
          return;
        }
        if (compared.deltaImage) {
          await atomicWrite(deltaPath, compared.deltaImage);
          await atomicWrite(deltaCachePath, JSON.stringify(source, null, 2) + '\n');
        }
        if (!record) {
          record = {
            ...compared.metrics,
            width: compared.width,
            height: compared.height,
            generatedAt: new Date().toISOString(),
          };
          await atomicWrite(metricsPath, JSON.stringify({ ...record, source }, null, 2) + '\n');
        }
        if (!(await stillCurrent())) {
          retry();
          return;
        }
        this.result.computed++;
        this.opts.onCompute?.(metricsPath);
      }
      if (cleanLegacyMetrics) {
        await atomicWrite(metricsPath, JSON.stringify({ ...record, source }, null, 2) + '\n');
        if (!(await stillCurrent())) {
          retry();
          return;
        }
      }
      pair.attempted = key;
      pair.force = false;
      this.metrics[pair.key] = { ...record, deltaFile: pair.delta.split('/').pop()! };
      this.indexDirty = true;
    } catch (error) {
      if (!this.current(pair, epoch) || signatureKey(await this.readInputs(pair).catch(() => null)) !== key) {
        retry();
        return;
      }
      pair.attempted = key; // Wait for changed inputs; do not spin on corrupt images.
      delete this.metrics[pair.key];
      this.indexDirty = true;
      this.result.failed.push({
        file: join(this.root, pair.renderer),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async drain(): Promise<ProcessResult> {
    do {
      while (this.pending.size || this.dirty.size || this.active.size) {
        const pending = [...this.pending];
        this.pending.clear();
        let scanned = 0;
        const reportScanning = () =>
          this.opts.onProgress?.({
            phase: 'Scanning changes',
            completed: scanned,
            total: pending.length,
            unit: 'scenes',
          });
        if (pending.length) reportScanning();
        for (const rel of pending) {
          try {
            if (!rel) {
              this.suite.hasReadme = !!(await signature(join(this.root, 'README.md')));
              this.suite.root.hasReadme = this.suite.hasReadme;
              this.indexDirty = true;
            } else {
              await this.reconcile(rel, await scanScene(this.root, rel, this.config));
              // Newly inserted groups and README-only changes need current presence flags too.
              let group = this.suite.root;
              for (const part of rel.split('/')) {
                const path = group.path ? `${group.path}/${part}` : part;
                const child = group.groups.find((g) => g.path === path);
                if (!child) break;
                child.hasReadme = !!(await signature(join(this.root, path, 'README.md')));
                group = child;
              }
            }
          } catch (error) {
            this.result.failed.push({
              file: join(this.root, rel),
              error: error instanceof Error ? error.message : String(error),
            });
          }
          scanned++;
          reportScanning();
        }
        this.pump();
        if (this.active.size) await Promise.race(this.active);
        else if (!this.pending.size) break; // Remaining dirty nodes belong to an unsettled watcher batch.
      }
      if (this.indexDirty) {
        this.opts.onProgress?.({ phase: 'Writing index', completed: 0, total: 1, unit: 'files' });
        const index: SuiteIndex = {
          ...this.suite,
          metrics: Object.fromEntries(Object.entries(this.metrics).toSorted(([a], [b]) => a.localeCompare(b))),
        };
        await mkdir(this.root, { recursive: true });
        await atomicWrite(join(this.root, 'index.json'), JSON.stringify(index, null, 2) + '\n');
        this.indexDirty = false;
        this.opts.onProgress?.({ phase: 'Writing index', completed: 1, total: 1, unit: 'files' });
      }
    } while (this.pending.size);
    this.force = false;
    this.progressCompleted = 0;
    this.progressTotal = 0;
    const result = this.result;
    this.result = emptyResult();
    result.failed.sort((a, b) => a.file.localeCompare(b.file));
    return result;
  }
}

/** Process discovered scenes through the same scheduler used by watch mode. */
export async function processSuite(root: string, opts: ProcessOptions = {}): Promise<ProcessResult> {
  return (await SuiteProcessor.create(root, opts)).initialize();
}

/** One-shot compatibility helper. Watch mode retains its SuiteProcessor instead. */
export async function processChanges(
  root: string,
  paths: Iterable<string>,
  onProgress?: ProgressCallback,
): Promise<ProcessResult> {
  const processor = await SuiteProcessor.create(root, { onProgress });
  try {
    await processor.initialize(false);
  } catch {
    return processSuite(root, { onProgress });
  }
  processor.notify(paths);
  return processor.flush();
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
