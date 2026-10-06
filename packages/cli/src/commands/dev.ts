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
      .option('port', { type: 'number', describe: 'Port to listen on (default: first open port from 3000)' })
      .option('host', { type: 'string', default: 'localhost', describe: 'Interface to bind (0.0.0.0 for all)' })
      .option('registry', { alias: 'suite', type: 'string', describe: 'Unified scene and renderer configuration file' })
      .option('root-url', { type: 'string', describe: 'Render server URL override' })
      .option('performance-root', { type: 'string', describe: 'Performance results directory' })
      .option('concurrency', { type: 'number', describe: 'Image pairs compared in parallel (default: CPU count)' })
      .option('quiet', { type: 'boolean', default: false, describe: 'Suppress progress and summary output' })
      .option('process', { type: 'boolean', default: true, describe: 'Refresh stale metrics/deltas before serving' })
      .option('watch', {
        type: 'boolean',
        default: true,
        describe: 'Keep metrics, deltas, and index updated as results change',
      }),
  handler: (argv) => run(argv, true),
});
