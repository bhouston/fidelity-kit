import { processSuite } from '../core/index.js';
import { defineCommand } from 'yargs-file-commands';

export const command = defineCommand({
  command: 'process <root>',
  describe: 'Compute metrics + delta images for stale pairs and write index.json',
  builder: (yargs) =>
    yargs
      .positional('root', {
        type: 'string',
        demandOption: true,
        describe: 'Suite results directory (contains fidelity.json)',
      })
      .option('force', { type: 'boolean', default: false, describe: 'Recompute even when up to date' }),
  handler: async (argv) => {
    const r = await processSuite(argv.root, { force: argv.force, onCompute: (f) => console.log('wrote', f) });
    console.log(`${r.computed} computed, ${r.skipped} up to date, ${r.failed.length} failed`);
    for (const f of r.failed) console.error(`FAILED ${f.file}: ${f.error}`);
    if (r.failed.length) process.exitCode = 1;
  },
});
