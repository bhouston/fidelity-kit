import { processSuite, type ProcessResult } from '../core/index.js';
import { defineCommand } from 'yargs-file-commands';
import { watchResults } from '../watch.js';
import { createProgress } from '../progress.js';

function report(r: ProcessResult, quiet: boolean) {
  if (!quiet) console.log(`${r.computed} computed, ${r.skipped} up to date, ${r.failed.length} failed`);
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
      .option('quiet', { type: 'boolean', default: false, describe: 'Suppress progress and summary output' })
      .option('force', { type: 'boolean', default: false, describe: 'Recompute even when up to date' })
      .option('watch', {
        type: 'boolean',
        default: false,
        describe: 'Keep metrics, deltas, and index updated as results change',
      }),
  handler: async (argv) => {
    const progress = createProgress('process', argv.quiet);
    const options = {
      force: argv.force,
      concurrency: argv.concurrency,
      onProgress: progress.update,
    };
    const onResult = (result: ProcessResult) => {
      progress.finish();
      report(result, argv.quiet);
    };
    if (argv.watch) {
      await watchResults(argv.root, onResult, options);
      if (!argv.quiet) console.log(`Watching ${argv.root}`);
    } else onResult(await processSuite(argv.root, options).finally(progress.finish));
  },
});
