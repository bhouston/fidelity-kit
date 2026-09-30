import { processSuite } from '../core/index.js';
import { defineCommand } from 'yargs-file-commands';
import { createProgress } from '../progress.js';

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
      .option('force', { type: 'boolean', default: false, describe: 'Recompute even when up to date' }),
  handler: async (argv) => {
    const progress = createProgress('process', argv.quiet);
    const r = await processSuite(argv.root, {
      force: argv.force,
      concurrency: argv.concurrency,
      onProgress: progress.update,
    }).finally(progress.finish);
    if (!argv.quiet) console.log(`${r.computed} computed, ${r.skipped} up to date, ${r.failed.length} failed`);
    for (const f of r.failed) console.error(`FAILED ${f.file}: ${f.error}`);
    if (r.failed.length) process.exitCode = 1;
  },
});
