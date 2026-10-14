import { defineCommand } from 'yargs-file-commands';
import { captureDynamic } from '../dynamic.js';
export const command = defineCommand({
  command: 'temporal',
  aliases: ['dynamic'],
  describe: 'Capture temporal fidelity sequences and score them against the temporal reference',
  builder: (yargs) =>
    yargs
      .option('registry', { alias: 'suite', type: 'string', demandOption: true })
      .option('root-url', { type: 'string', describe: 'Browser render server URL' })
      .option('out', { type: 'string', default: 'fidelity-results' })
      .option('renderers', { type: 'string', describe: 'Renderer ID glob(s), comma separated' })
      .option('scenes', { type: 'string', describe: 'Scene ID glob(s), comma separated' })
      .option('headful', { type: 'boolean', default: false })
      .option('chrome-arg', { type: 'array', string: true, describe: 'Additional browser launch arguments' })
      .option('executable-path', { type: 'string' }),
  handler: async (argv) => {
    await captureDynamic({ ...argv, chromeArgs: argv.chromeArg });
  },
});
