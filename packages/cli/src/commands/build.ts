import { cp } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { statSync } from 'node:fs';
import { defineCommand } from 'yargs-file-commands';
import { processSuite } from '../core/index.js';
import { assertViewerBuilt, isDataFile, viewerDir } from '../server.js';

export const command = defineCommand({
  command: 'build <root>',
  describe: 'Export a static site (viewer + suite images) for any static host',
  builder: (yargs) =>
    yargs
      .positional('root', {
        type: 'string',
        demandOption: true,
        describe: 'Suite results directory (contains fidelity.json)',
      })
      .option('out', { type: 'string', demandOption: true, describe: 'Output directory' })
      .option('process', { type: 'boolean', default: true, describe: 'Refresh stale metrics/deltas first' }),
  handler: async (argv) => {
    assertViewerBuilt();
    const root = resolve(argv.root);
    const out = resolve(argv.out);
    if (argv.process) await processSuite(root);
    await cp(viewerDir, out, { recursive: true });
    await cp(root, `${out}/data`, {
      recursive: true,
      filter: (src) => src === root || statSync(src).isDirectory() || isDataFile(relative(root, src)),
    });
    console.log(`Wrote static site to ${out}`);
  },
});
