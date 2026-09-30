import { defineCommand } from 'yargs-file-commands';
import { run } from '../run.js';
import { defaultCachePolicy } from '../server.js';

export const command = defineCommand({
  command: 'serve <root>',
  describe: 'Serve the viewer for a results directory (lazy ETags and shared-cache headers)',
  builder: (yargs) =>
    yargs
      .positional('root', {
        type: 'string',
        demandOption: true,
        describe: 'Suite results directory (contains fidelity.json)',
      })
      .option('port', { type: 'number', describe: 'Port to listen on (default: first open port from 3000)' })
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
      .option('concurrency', { type: 'number', describe: 'Image pairs compared in parallel (default: CPU count)' })
      .option('process', { type: 'boolean', default: true, describe: 'Refresh stale metrics/deltas before serving' }),
  handler: (argv) => run(argv, false),
});
