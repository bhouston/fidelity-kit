import type { CommandModule } from 'yargs';
import { startServer } from '../server.js';
import { processResults } from '../storage.js';
const command: CommandModule = {
  command: 'serve',
  describe: 'Serve a static performance report without watching results',
  builder: (yargs) =>
    yargs
      .option('out', { type: 'string', default: 'performance-results' })
      .option('host', { type: 'string', default: 'localhost' })
      .option('port', { type: 'number', default: 4400 }),
  handler: async (args) => {
    await processResults(args.out as string);
    const server = await startServer({
      out: args.out as string,
      host: args.host as string,
      port: args.port as number,
    });
    console.log(`Performance report: ${server.url}`);
    for (const signal of ['SIGINT', 'SIGTERM'] as const)
      process.once(signal, () => {
        void server.close();
      });
  },
};
export default command;
