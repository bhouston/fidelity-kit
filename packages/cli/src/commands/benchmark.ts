import type { CommandModule } from 'yargs';
import { runSuite } from '../performance/runner.js';
const command: CommandModule = {
  command: 'benchmark',
  describe: 'Benchmark each workload once and save flat metrics',
  builder: (yargs) =>
    yargs
      .option('registry', { alias: 'suite', type: 'string', demandOption: true })
      .option('out', { type: 'string', default: 'performance-results' })
      .option('machine', {
        type: 'string',
        describe: 'Machine folder ID inside --out (defaults to a slug of the host name)',
      })
      .option('new-run', { type: 'boolean', describe: 'Start a new dated run without prompting' })
      .option('session', { type: 'string', describe: 'Add to an existing YYYY-MM-DD-HH-MM run, or latest' })
      .option('machine-name', { type: 'string', describe: 'Human-readable machine description saved to machine.json' })
      .option('renderer', {
        type: 'array',
        string: true,
        describe: 'Renderer ID glob(s), repeatable or comma separated',
      })
      .option('scene', { type: 'array', string: true, describe: 'Scene ID glob(s), repeatable or comma separated' })
      .option('renderers', { type: 'string', describe: 'Renderer ID glob(s), comma separated; intersects --renderer' })
      .option('scenes', { type: 'string', describe: 'Scene ID glob(s), comma separated; intersects --scene' })
      .option('headful', { type: 'boolean', default: false })
      .option('live', { type: 'boolean', default: false })
      .option('host', { type: 'string', default: 'localhost' })
      .option('port', { type: 'number', default: 4400 })
      .option('root-url', { type: 'string', describe: 'Root URL of the browser render server' })
      .option('collection', { type: 'string', describe: 'Opt-in performance collection in a unified suite' })
      .option('renderer-root', {
        type: 'string',
        describe: 'Static renderer directory served cross-site on 127.0.0.1',
      })
      .option('renderer-port', { type: 'number', default: 4401 })
      .option('seed', { type: 'number' })
      .option('cooldown-ms', { type: 'number', default: 2000 })
      .option('recycle', { type: 'number', describe: 'Recycle Chrome every N runs' })
      .option('width', { type: 'number', default: 1920 })
      .option('height', { type: 'number', default: 1080 })
      .option('isolation', {
        choices: ['iframe', 'page'] as const,
        describe: 'Isolation mode; unified suites default to a fresh page for remote render hosts',
      })
      .option('allow-software', { type: 'boolean', default: false })
      .option('executable-path', { type: 'string' })
      .option('vsync', {
        choices: ['off'] as const,
        describe: 'Throughput benchmarks require vsync off (recorded in each result)',
      })
      .option('chrome-arg', {
        type: 'array',
        string: true,
        describe: 'Extra Chrome flag, repeatable; use --chrome-arg=--flag (recorded in environment.chromeFlags)',
      })
      .option('fail-on-error', { type: 'boolean', default: true }),
  handler: async (args) => {
    await runSuite({
      suite: args.registry as string,
      rootUrl: args.rootUrl as string | undefined,
      collection: args.collection as string | undefined,
      out: args.out as string,
      machine: args.machine as string | undefined,
      newRun: args.newRun as boolean | undefined,
      session: args.session as string | undefined,
      machineName: args.machineName as string | undefined,
      renderer: args.renderer as string[] | undefined,
      scene: args.scene as string[] | undefined,
      renderers: args.renderers as string | undefined,
      scenes: args.scenes as string | undefined,
      headful: args.headful as boolean,
      live: args.live as boolean,
      host: args.host as string,
      port: args.port as number,
      rendererRoot: args.rendererRoot as string | undefined,
      rendererPort: args.rendererPort as number,
      seed: args.seed as number | undefined,
      cooldownMs: args.cooldownMs as number,
      recycle: args.recycle as number | undefined,
      width: args.width as number,
      height: args.height as number,
      isolation: args.isolation as 'iframe' | 'page',
      allowSoftware: args.allowSoftware as boolean,
      executablePath: args.executablePath as string | undefined,
      chromeArgs: args.chromeArg as string[] | undefined,
      vsync: args.vsync as 'on' | 'off' | undefined,
      failOnError: args.failOnError as boolean,
    });
  },
};
export default command;
