import { processSuite, type ProcessResult } from '../core/index.js';
import { defineCommand } from 'yargs-file-commands';
import { watchResults } from '../watch.js';

function report(r: ProcessResult) {
  console.log(`${r.computed} computed, ${r.skipped} up to date, ${r.failed.length} failed`);
  for (const f of r.failed) console.error(`FAILED ${f.file}: ${f.error}`);
  if (r.failed.length) process.exitCode = 1;
}

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
      .option('concurrency', { type: 'number', describe: 'Image pairs compared in parallel (default: CPU count)' })
      .option('force', { type: 'boolean', default: false, describe: 'Recompute even when up to date' })
      .option('watch', {
        type: 'boolean',
        default: false,
        describe: 'Keep metrics, deltas, and index updated as results change',
      }),
  handler: async (argv) => {
    const options = {
      force: argv.force,
      concurrency: argv.concurrency,
      onCompute: (f: string) => console.log('wrote', f),
    };
    if (argv.watch) {
      await watchResults(argv.root, report, options);
      console.log(`Watching ${argv.root}`);
    } else report(await processSuite(argv.root, options));
  },
});
