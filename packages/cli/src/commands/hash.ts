import { availableParallelism } from 'node:os';
import { defineCommand } from 'yargs-file-commands';
import { hashSuite } from '../core/index.js';

export const command = defineCommand({
  command: 'hash <root>',
  describe: 'Write image-hashes.json so `serve` can use immutable, content-hashed image URLs from the first request',
  builder: (yargs) =>
    yargs
      .positional('root', {
        type: 'string',
        demandOption: true,
        describe: 'Suite results directory (contains fidelity.json)',
      })
      .option('concurrency', {
        type: 'number',
        default: availableParallelism(),
        describe: 'Files hashed in parallel (default: os.availableParallelism())',
      }),
  handler: async (argv) => {
    const r = await hashSuite(argv.root, { concurrency: argv.concurrency });
    console.log(`${r.hashed} hashed, ${r.reused} reused, ${r.total} total`);
  },
});
