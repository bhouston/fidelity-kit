#!/usr/bin/env node
import { processSuite } from '@fidelity-kit/core';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

await yargs(hideBin(process.argv))
  .scriptName('fidelity')
  .command(
    'process <root>',
    'Compute metrics + delta images for stale pairs and write index.json',
    (y) =>
      y.positional('root', { type: 'string', demandOption: true }).option('force', { type: 'boolean', default: false }),
    async (a) => {
      const r = await processSuite(a.root, { force: a.force, onCompute: (f) => console.log('wrote', f) });
      console.log(`${r.computed} computed, ${r.skipped} up to date, ${r.failed.length} failed`);
      for (const f of r.failed) console.error(`FAILED ${f.file}: ${f.error}`);
      if (r.failed.length) process.exitCode = 1;
    },
  )
  .demandCommand(1)
  .strict()
  .parseAsync();
