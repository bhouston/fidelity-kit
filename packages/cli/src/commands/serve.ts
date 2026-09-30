import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineCommand } from 'yargs-file-commands';
import { processSuite } from '../core/index.js';
import { assertViewerBuilt, createHandler, serve } from '../server.js';

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
    await serve(createHandler(root), argv.port, argv.host);
    console.log(`Serving ${root} at http://${argv.host}:${argv.port}`);
  },
});
