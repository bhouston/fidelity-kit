import { cp, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { statSync } from 'node:fs';
import { humanizeBytes } from 'humanize-units';
import pLimit from 'p-limit';
import { defineCommand } from 'yargs-file-commands';
import { processSuite } from '../core/index.js';
import { printWarnings } from '../warnings.js';
import { assertViewerBuilt, isDataFile, viewerDir } from '../server.js';

export const command = defineCommand({
  command: 'build <root>',
  describe: 'Export a static site (viewer + suite images) for any static host',
  builder: (yargs) =>
    yargs
      .positional('root', {
        type: 'string',
        demandOption: true,
        describe: 'Suite results directory (contains fidelity.json)',
      })
      .option('out', { type: 'string', demandOption: true, describe: 'Output directory' })
      .option('concurrency', { type: 'number', describe: 'Image pairs compared in parallel (default: CPU count)' })
      .option('process', { type: 'boolean', default: true, describe: 'Refresh stale metrics/deltas first' }),
  handler: async (argv) => {
    assertViewerBuilt();
    const root = resolve(argv.root);
    const out = resolve(argv.out);
    if (argv.process) {
      const result = await processSuite(root, { concurrency: argv.concurrency });
      printWarnings(result.warnings);
      if (result.failed.length)
        throw new Error(
          `Failed to compare ${result.failed.length} image pair(s): ${result.failed.map((f) => `${f.file}: ${f.error}`).join('; ')}`,
        );
    }
    await cp(viewerDir, out, { recursive: true });
    await cp(root, `${out}/data`, {
      recursive: true,
      filter: (src) => src === root || statSync(src).isDirectory() || isDataFile(relative(root, src)),
    });
    const files = (await readdir(out, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile());
    const limit = pLimit(32);
    let bytes = 0;
    await Promise.all(
      files.map((entry) =>
        limit(async () => {
          const size = (await stat(join(entry.parentPath, entry.name))).size;
          bytes += size;
        }),
      ),
    );
    console.log(`Build output: ${files.length} files, ${humanizeBytes(bytes, { unitSeparator: ' ' })}`);
  },
});
