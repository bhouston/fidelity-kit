import { defineCommand } from 'yargs-file-commands';
import { run } from '../run.js';

export const command = defineCommand({
  command: 'dev <root>',
  describe: 'Serve the viewer for local work: nothing is cached, no ETags, every request reads the file fresh',
  builder: (yargs) =>
    yargs
      .positional('root', {
        type: 'string',
        demandOption: true,
        describe: 'Suite results directory (contains fidelity.json)',
      })
      .option('port', { type: 'number', default: 3000, describe: 'Port to listen on' })
      .option('host', { type: 'string', default: 'localhost', describe: 'Interface to bind (0.0.0.0 for all)' })
      .option('concurrency', { type: 'number', describe: 'Image pairs compared in parallel (default: CPU count)' })
      .option('process', { type: 'boolean', default: true, describe: 'Refresh stale metrics/deltas before serving' })
      .option('watch', {
        type: 'boolean',
        default: true,
        describe: 'Keep metrics, deltas, and index updated as results change',
      }),
  handler: (argv) => run(argv, true),
});
