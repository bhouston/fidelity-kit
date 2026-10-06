import { defineCommand } from 'yargs-file-commands';
import { renderSuite } from '../render.js';
export const command = defineCommand({
  command: 'render',
  describe: 'Capture fidelity images using the shared browser render server or external producer',
  builder: (yargs) =>
    yargs
      .option('registry', { alias: 'suite', type: 'string', demandOption: true })
      .option('root-url', { type: 'string', describe: 'Browser render server URL' })
      .option('out', { type: 'string', default: 'fidelity-results' })
      .option('renderer', { type: 'array', string: true })
      .option('scene', { type: 'array', string: true })
      .option('frames', { type: 'number' })
      .option('headful', { type: 'boolean', default: false })
      .option('chrome-arg', { type: 'array', string: true, describe: 'Additional browser launch arguments' })
      .option('executable-path', { type: 'string' }),
  handler: (argv) => renderSuite({ ...argv, chromeArgs: argv.chromeArg }),
});
