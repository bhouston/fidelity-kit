import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve, basename, sep } from 'node:path';
import { parseRegistry, rendererUrl, type RenderingRegistry } from './registry.js';
import { processResults, readReportIndex, atomicWrite } from './performance/storage.js';

export interface SiteManifest {
  registry: RenderingRegistry;
  rendererUrl: string;
}
export async function prepareSite(
  root: string,
  options: { registry?: string; rootUrl?: string },
  mode: 'development' | 'deployed',
) {
  if (!options.registry) return;
  const suite = parseRegistry(JSON.parse(await readFile(resolve(options.registry), 'utf8')));
  const url = rendererUrl(suite, mode, options.rootUrl);
  // Publish only the active endpoint: a static deployment never silently falls back to localhost.
  const activeRoot =
    options.rootUrl ?? (mode === 'development' ? suite.renderServer.developmentUrl : suite.renderServer.deployedUrl)!;
  const manifest: SiteManifest = {
    registry: {
      ...suite,
      renderServer: { developmentUrl: activeRoot, deployedUrl: activeRoot, entry: suite.renderServer.entry },
    },
    rendererUrl: url.href,
  };
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'site.json'), JSON.stringify(manifest, null, 2) + '\n');
  let outputs: unknown;
  try {
    outputs = JSON.parse(await readFile(join(root, 'fidelity.json'), 'utf8')).outputs;
  } catch {}
  await writeFile(
    join(root, 'fidelity.json'),
    JSON.stringify(
      {
        title: suite.title,
        renderers: suite.renderers.map((r) => ({
          id: r.id,
          label: r.name,
          reference: r.reference,
          enabled: r.enabled,
          ...(r.category ? { category: r.category } : {}),
        })),
        ...(suite.comparisonPresets ? { comparisonPresets: suite.comparisonPresets } : {}),
        ...(outputs ? { outputs } : {}),
      },
      null,
      2,
    ) + '\n',
  );
}
/** Copy processed performance artifacts into the website data namespace, including machine metadata and optional targets. */
export async function copyPerformance(root: string, source?: string) {
  if (!source) return;
  const destination = join(root, 'performance');
  const input = resolve(source);
  if (
    resolve(destination) === input ||
    input.startsWith(resolve(destination) + sep) ||
    resolve(destination).startsWith(input + sep)
  )
    throw new Error('Performance source must be outside the site data directory');
  const index = await processResults(input);
  const previous = await readReportIndex(destination);
  const filesFor = (result: (typeof index.results)[number]) =>
    [result.metrics, result.screenshot, result.reference, result.diff].filter((file): file is string => !!file);
  const current = new Set(index.results.flatMap(filesFor));
  for (const file of previous.results.flatMap(filesFor)) {
    if (current.has(file)) continue;
    const owned = resolve(destination, file);
    if (
      owned.startsWith(resolve(destination) + sep) &&
      ['metrics.json', 'screenshot.avif', 'reference.png', 'diff.png'].includes(basename(owned))
    )
      await rm(owned, { force: true });
  }
  await mkdir(destination, { recursive: true });
  // Index contains only public artifacts; source run traces remain in the results directory.
  for (const result of index.results)
    for (const rel of [result.metrics, result.screenshot, result.reference, result.diff]) {
      if (!rel) continue;
      await mkdir(resolve(destination, rel, '..'), { recursive: true });
      await cp(join(input, rel), join(destination, rel));
    }
  await atomicWrite(join(destination, 'index.json'), JSON.stringify({ ...index, liveReload: false }, null, 2) + '\n');
  try {
    await cp(join(input, 'README.md'), join(destination, 'README.md'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await rm(join(destination, 'README.md'), { force: true });
  }
}

/** Refresh the published snapshot when benchmark files change during local development. */
export async function watchPerformance(root: string, source: string) {
  const { watch } = await import('chokidar');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = Promise.resolve();
  let closed = false;
  const watcher = watch(resolve(source), {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    ignored: (path, stats) =>
      !!stats?.isFile() && !/(?:metrics\.json|machine\.json|screenshot\.avif|reference\.png|README\.md)$/.test(path),
  });
  watcher.on('all', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      pending = pending
        .then(async () => {
          if (!closed) await copyPerformance(root, source);
        })
        .catch((error) => console.error('Performance publication failed:', error));
    }, 250);
  });
  watcher.on('error', (error) => console.error('Performance watch failed:', error));
  await new Promise<void>((ready, reject) => {
    watcher.once('ready', ready);
    watcher.once('error', reject);
  });
  return {
    async close() {
      closed = true;
      clearTimeout(timer);
      await watcher.close();
      await pending;
    },
  };
}
