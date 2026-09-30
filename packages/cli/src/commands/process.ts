import { processSuite } from '../core/index.js';
import { defineCommand } from 'yargs-file-commands';
import { watchResults } from '../watch.js';

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
      .option('force', { type: 'boolean', default: false, describe: 'Recompute even when up to date' })
      .option('watch', {
        type: 'boolean',
        default: false,
        describe: 'Keep metrics, deltas, and index updated as results change',
      }),
  handler: async (argv) => {
    const r = await processSuite(argv.root, { force: argv.force, onCompute: (f) => console.log('wrote', f) });
    console.log(`${r.computed} computed, ${r.skipped} up to date, ${r.failed.length} failed`);
    for (const f of r.failed) console.error(`FAILED ${f.file}: ${f.error}`);
    if (r.failed.length) process.exitCode = 1;
    if (argv.watch) {
      await watchResults(argv.root, (update) => {
        console.log(`${update.computed} computed, ${update.skipped} up to date, ${update.failed.length} failed`);
        for (const f of update.failed) console.error(`FAILED ${f.file}: ${f.error}`);
      });
      console.log(`Watching ${argv.root}`);
    }
  },
});
