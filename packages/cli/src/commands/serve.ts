import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineCommand } from 'yargs-file-commands';
import { processSuite } from '../core/index.js';
import { assertViewerBuilt, createHandler, defaultCachePolicy, serve } from '../server.js';

export const command = defineCommand({
  command: 'serve <root>',
  describe: 'Serve the viewer for a results directory',
  builder: (yargs) =>
    yargs
      .positional('root', {
        type: 'string',
        demandOption: true,
        describe: 'Suite results directory (contains fidelity.json)',
      })
      .option('port', { type: 'number', default: 3000, describe: 'Port to listen on' })
      .option('host', { type: 'string', default: 'localhost', describe: 'Interface to bind (0.0.0.0 for all)' })
      .option('max-age', {
        type: 'number',
        default: defaultCachePolicy.maxAge,
        describe: 'Seconds images are cached (browsers and CDNs) without revalidation',
      })
      .option('stale-while-revalidate', {
        type: 'number',
        default: defaultCachePolicy.staleWhileRevalidate,
        describe: 'Seconds a stale image may be served while it refreshes in the background',
      })
      .option('process', { type: 'boolean', default: true, describe: 'Refresh stale metrics/deltas before serving' }),
  handler: async (argv) => {
    assertViewerBuilt();
    const root = resolve(argv.root);
    if (argv.process) {
      const r = await processSuite(root);
      console.log(`${r.computed} computed, ${r.skipped} up to date, ${r.failed.length} failed`);
    } else if (!existsSync(`${root}/index.json`)) {
      throw new Error(`No index.json in ${root}; run \`fidelity-kit process\` or drop --no-process.`);
    }
    const cache = { maxAge: argv.maxAge, staleWhileRevalidate: argv.staleWhileRevalidate };
    await serve(createHandler(root, undefined, cache), argv.port, argv.host);
    console.log(`Serving ${root} at http://${argv.host}:${argv.port}`);
  },
});
