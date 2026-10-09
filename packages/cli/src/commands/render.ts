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
      .option('renderers', { type: 'string', describe: 'Renderer ID glob(s), comma separated' })
      .option('scenes', { type: 'string', describe: 'Scene ID glob(s), comma separated' })
      .option('missing-only', { type: 'boolean', default: false, describe: 'Skip existing images' })
      .option('frames', { type: 'number' })
      .option('capture-params', { type: 'string', describe: 'JSON project capture policy overrides' })
      .option('headful', { type: 'boolean', default: false })
      .option('chrome-arg', { type: 'array', string: true, describe: 'Additional browser launch arguments' })
      .option('executable-path', { type: 'string' }),
  handler: (argv) =>
    renderSuite({
      ...argv,
      captureParams: argv.captureParams ? JSON.parse(argv.captureParams) : undefined,
      chromeArgs: argv.chromeArg,
    }),
});
