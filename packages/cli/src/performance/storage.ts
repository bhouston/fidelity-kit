import { performanceSiteIndex } from './site-index.js';
import { parseRegistry, performanceSuite } from '../registry.js';
import { mkdir, readFile, readdir, writeFile, cp, rename, stat, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { assertRunResult, assertSuite, assertProcessedResult, assertNamedEntity, processRun } from '../schema/index.js';
import { referenceDiff } from './convergence.js';
import { encodeCapture } from './capture.js';
import type { RunResult, ProcessedResult, Suite, NamedEntity } from '../schema/index.js';
export function safeEntryId(id: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id) || id === '.' || id === '..') throw new Error(`Unsafe id: ${id}`);
  return id;
}
export async function atomicWrite(file: string, data: string | Uint8Array): Promise<void> {
  await mkdir(resolve(file, '..'), { recursive: true });
  const temp = join(resolve(file, '..'), `.${basename(file)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, data);
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
}
export async function loadSuite(file: string, collection?: string): Promise<Suite> {
  const value: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (value && typeof value === 'object' && 'renderServer' in value) {
    const translated = performanceSuite(parseRegistry(value), collection);
    assertSuite(translated);
    return translated;
  }
  assertSuite(value);
  for (const entry of value.entries) {
    const url = new URL(entry.url, 'http://127.0.0.1');
    if (!['http:', 'https:'].includes(url.protocol))
      throw new Error(`Entry ${entry.id}: renderer URL must use HTTP or HTTPS (relative URLs are allowed)`);
  }
  return value;
}
export interface ResultReference {
  machine: NamedEntity;
  /** Path-safe UTC date-time of the benchmark invocation; absent for legacy data. */
  session?: string;
  recordedAt?: string;
  renderer: NamedEntity;
  scene: NamedEntity;
  metrics: string;
  screenshot?: string;
  reference?: string;
  diff?: string;
}
export interface ReportIndex {
  schemaVersion: 2;
  machines: NamedEntity[];
  results: ResultReference[];
}
export interface ResultRecord {
  result: ProcessedResult;
  file: string;
}
async function directories(path: string) {
  try {
    return (await readdir(path, { withFileTypes: true })).filter(
      (entry) => entry.isDirectory() && !entry.name.startsWith('.'),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function loadMetrics(root: string, prefix: string): Promise<ProcessedResult | undefined> {
  let result: unknown;
  try {
    result = JSON.parse(await readFile(join(root, prefix, 'metrics.json'), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (result === undefined) return undefined;
  assertProcessedResult(result);
  const parts = prefix.split('/');
  const machineId = parts[0];
  const session = parts.length === 4 ? parts[1] : undefined;
  if (session) sessionDate(session);
  const recordedMachine = result.environment?.host.machineId;
  if (
    [machineId, ...(session ? [session] : []), result.entry.renderer.id, result.entry.scene.id].join('/') !== prefix ||
    (recordedMachine !== undefined && recordedMachine !== machineId)
  )
    throw new Error(`Result metadata does not match its folder: ${prefix}`);
  return result;
}
/** Reads `<machine>/machine.json`; machines without one are named by their folder id. */
export async function readMachine(root: string, machineId: string): Promise<NamedEntity> {
  let machine: unknown;
  try {
    machine = JSON.parse(await readFile(join(root, safeEntryId(machineId!), 'machine.json'), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { id: machineId, name: machineId };
    throw error;
  }
  assertNamedEntity(machine);
  if (machine.id !== machineId) throw new Error(`Machine metadata does not match its folder: ${machineId}`);
  return machine;
}
export async function writeMachine(root: string, machine: NamedEntity): Promise<void> {
  assertNamedEntity(machine);
  safeEntryId(machine.id);
  await atomicWrite(join(root, machine.id, 'machine.json'), `${JSON.stringify(machine, null, 2)}\n`);
}
/** UTC start time with minute precision, safe on Windows. */
export function benchmarkSession(date = new Date()): string {
  return date.toISOString().slice(0, 16).replace('T', '-').replace(':', '-');
}
export function sessionDate(session: string): string {
  if (!/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(session)) throw new Error(`Invalid benchmark session: ${session}`);
  const iso = `${session.slice(0, 10)}T${session.slice(11, 13)}:${session.slice(14, 16)}:00.000Z`;
  if (!Number.isFinite(Date.parse(iso)) || benchmarkSession(new Date(iso)) !== session)
    throw new Error(`Invalid benchmark session: ${session}`);
  return iso;
}
export async function chooseBenchmarkSession(
  root: string,
  machineId: string,
  options: { session?: string; newRun?: boolean } = {},
  ask?: (latest: string) => Promise<'new' | 'existing'>,
): Promise<string> {
  if (options.session && options.newRun) throw new Error('Choose either --new-run or --session');
  const machine = join(root, safeEntryId(machineId));
  const sessions = (await directories(machine))
    .map((entry) => entry.name)
    .filter((name) => {
      try {
        sessionDate(name);
        return true;
      } catch {
        return false;
      }
    })
    .toSorted()
    .toReversed();
  let selected = options.session;
  if (!selected && !options.newRun && sessions.length) {
    if (!ask) throw new Error('Existing benchmark runs found. Choose --new-run or --session latest (or a date-time).');
    if ((await ask(sessions[0]!)) === 'existing') selected = sessions[0];
  }
  if (selected) {
    const session = selected === 'latest' ? sessions[0] : selected;
    if (!session || !sessions.includes(session)) throw new Error(`Benchmark session does not exist: ${selected}`);
    sessionDate(session);
    return session;
  }
  const session = benchmarkSession();
  await mkdir(machine, { recursive: true });
  try {
    await mkdir(join(machine, session));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new Error(
        `A run already started at ${session}. Add to it with --session ${session}, or start a new run in the next minute.`,
        { cause: error },
      );
    throw error;
  }
  return session;
}
export async function scanResults(root: string): Promise<{ runs: ResultRecord[] }> {
  const runs: ResultRecord[] = [];
  const scan = async (prefix: string, depth: number): Promise<void> => {
    if (depth === 3 || depth === 4) {
      const result = await loadMetrics(root, prefix);
      if (result) {
        runs.push({ result, file: `${prefix}/metrics.json` });
        return;
      }
    }
    if (depth < 4)
      for (const directory of await directories(join(root, prefix)))
        await scan(prefix ? `${prefix}/${directory.name}` : directory.name, depth + 1);
  };
  await scan('', 0);
  return { runs };
}
async function referenceFor(
  root: string,
  machine: NamedEntity,
  result: ProcessedResult,
  prefix: string,
): Promise<ResultReference> {
  const session = prefix.split('/').length === 4 ? prefix.split('/')[1] : undefined;
  let screenshot: string | undefined;
  try {
    if (result.screenshot && (await stat(join(root, prefix, 'screenshot.avif'))).isFile())
      screenshot = `${prefix}/screenshot.avif`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return {
    machine,
    ...(session ? { session, recordedAt: sessionDate(session) } : {}),
    renderer: result.entry.renderer,
    scene: result.entry.scene,
    metrics: `${prefix}/metrics.json`,
    ...(screenshot ? { screenshot } : {}),
    ...(result.convergence?.reference ? { reference: `${prefix}/reference.png` } : {}),
    ...(result.convergence?.diff ? { diff: `${prefix}/diff.png` } : {}),
  };
}
async function saveIndex(root: string, index: ReportIndex, onWrite?: (file: string, contents: string) => void) {
  index.results = index.results.toSorted((a, b) => a.metrics.localeCompare(b.metrics));
  const machines = new Map(index.results.map((item) => [item.machine.id, item.machine]));
  index.machines = [...machines.values()].toSorted((a, b) => a.id.localeCompare(b.id));
  const contents = JSON.stringify(index);
  try {
    if ((await readFile(join(root, 'index.json'), 'utf8')) === contents) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  onWrite?.('index.json', contents);
  await atomicWrite(join(root, 'index.json'), contents);
}
export async function processResults(
  root: string,
  onWrite?: (file: string, contents: string) => void,
): Promise<ReportIndex> {
  await mkdir(root, { recursive: true });
  const index: ReportIndex = { schemaVersion: 2, machines: [], results: [] };
  const machines = new Map<string, NamedEntity>();
  for (const { result, file } of (await scanResults(root)).runs) {
    const machineId = file.split('/')[0]!;
    if (!machines.has(machineId)) machines.set(machineId, await readMachine(root, machineId!));
    index.results.push(await referenceFor(root, machines.get(machineId)!, result, dirname(file).split(sep).join('/')));
  }
  await saveIndex(root, index, onWrite);
  return index;
}
export async function processResult(
  root: string,
  machineId: string,
  rendererId: string,
  sceneId: string,
  onWrite?: (file: string, contents: string) => void,
  session?: string,
): Promise<void> {
  if (session) sessionDate(session);
  const prefix = [
    safeEntryId(machineId!),
    ...(session ? [session] : []),
    safeEntryId(rendererId!),
    safeEntryId(sceneId!),
  ].join('/');
  const result = await loadMetrics(root, prefix);
  const reference = result ? await referenceFor(root, await readMachine(root, machineId!), result, prefix) : undefined;
  const index = await readReportIndex(root);
  index.results = index.results.filter(
    (item) =>
      item.machine.id !== machineId ||
      item.renderer.id !== rendererId ||
      item.scene.id !== sceneId ||
      item.session !== session,
  );
  if (reference) index.results.push(reference);
  await saveIndex(root, index, onWrite);
}
export async function readReportIndex(root: string): Promise<ReportIndex> {
  try {
    const index = JSON.parse(await readFile(join(root, 'index.json'), 'utf8')) as ReportIndex;
    // Indexes written before machine folders cannot be updated incrementally; start a fresh index.
    if (index.schemaVersion === 2) return index;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return { schemaVersion: 2, machines: [], results: [] };
}
export async function writeRun(
  root: string,
  machineId: string,
  result: RunResult,
  png?: Uint8Array,
  reference?: Uint8Array,
  session?: string,
): Promise<string> {
  assertRunResult(result);
  if (session) sessionDate(session);
  if (result.environment) result.environment.host.machineId = machineId;
  const folder = join(
    root,
    safeEntryId(machineId!),
    ...(session ? [session] : []),
    safeEntryId(result.entry.renderer.id),
    safeEntryId(result.entry.scene.id),
  );
  await mkdir(folder, { recursive: true });
  if (png) {
    await atomicWrite(join(folder, 'screenshot.avif'), await encodeCapture(png));
    result.capture = {
      file: 'screenshot.avif',
      at: result.capture?.at ?? result.harness.captureSent ?? result.harness.teardown,
    };
  } else {
    await rm(join(folder, 'screenshot.avif'), { force: true });
    delete result.capture;
  }
  if (reference && result.reporter.convergence) {
    await atomicWrite(join(folder, 'reference.png'), reference);
    result.reporter.convergence.reference = 'reference.png';
    if (png) {
      await atomicWrite(join(folder, 'diff.png'), await referenceDiff(reference, png));
      result.reporter.convergence.diff = 'diff.png';
    } else {
      await rm(join(folder, 'diff.png'), { force: true });
      delete result.reporter.convergence.diff;
    }
  } else {
    for (const name of ['reference.png', 'diff.png']) await rm(join(folder, name), { force: true });
    if (result.reporter.convergence) {
      delete result.reporter.convergence.reference;
      delete result.reporter.convergence.diff;
    }
  }
  assertRunResult(result);
  const file = join(folder, 'metrics.json');
  const metrics = processRun(result);
  assertProcessedResult(metrics);
  await atomicWrite(file, `${JSON.stringify(metrics, null, 2)}\n`);
  await processResult(root, machineId, result.entry.renderer.id, result.entry.scene.id, undefined, session);
  return file;
}
export async function viewerDirectory(): Promise<string> {
  const packaged = fileURLToPath(new URL('../../viewer', import.meta.url));
  try {
    if ((await stat(join(packaged, 'index.html'))).isFile()) return packaged;
  } catch {}
  const workspace = fileURLToPath(new URL('../../../viewer/dist', import.meta.url));
  try {
    await stat(join(workspace, 'index.html'));
    return workspace;
  } catch {
    throw new Error('Viewer is not built. Run pnpm build first.');
  }
}
export async function buildReport(out: string, site: string): Promise<void> {
  const input = resolve(out),
    destination = resolve(site);
  if (input === destination || destination.startsWith(input + sep) || input.startsWith(destination + sep))
    throw new Error('Site and result folders must be separate');
  const previous = await readReportIndex(destination);
  const index = await processResults(input);
  const current = new Set(index.results.map((item) => item.metrics));
  for (const old of previous.results ?? []) {
    if (current.has(old.metrics)) continue;
    const folder = join(destination, dirname(old.metrics));
    if (!folder.startsWith(destination + sep)) continue;
    for (const name of ['metrics.json', 'screenshot.avif', 'reference.png', 'diff.png'])
      await rm(join(folder, name), { force: true });
  }
  await mkdir(destination, { recursive: true });
  await cp(await viewerDirectory(), destination, { recursive: true });
  for (const ref of index.results) {
    const folder = join(destination, dirname(ref.metrics));
    await mkdir(folder, { recursive: true });
    await cp(join(input, ref.metrics), join(destination, ref.metrics));
    if (ref.screenshot) await cp(join(input, ref.screenshot), join(destination, ref.screenshot));
    else await rm(join(folder, 'screenshot.avif'), { force: true });
    for (const [file, name] of [
      [ref.reference, 'reference.png'],
      [ref.diff, 'diff.png'],
    ] as const) {
      if (file) await cp(join(input, file), join(destination, file));
      else await rm(join(folder, name), { force: true });
    }
  }
  try {
    await cp(join(input, 'README.md'), join(destination, 'README.md'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await rm(join(destination, 'README.md'), { force: true });
  }
  await atomicWrite(join(destination, 'index.json'), JSON.stringify(index));
  // Retain old public file paths for API consumers and also provide the unified viewer data namespace.
  const data = join(destination, 'data');
  await atomicWrite(join(data, 'index.json'), JSON.stringify(performanceSiteIndex(index)));
  await atomicWrite(join(data, 'performance/index.json'), JSON.stringify(index));
  for (const result of index.results)
    for (const file of [result.metrics, result.screenshot, result.reference, result.diff]) {
      if (!file) continue;
      await mkdir(join(data, 'performance', dirname(file)), { recursive: true });
      await cp(join(input, file), join(data, 'performance', file));
    }
  try {
    await cp(join(input, 'README.md'), join(data, 'performance/README.md'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
