import type { CommandModule } from 'yargs';
import { startServer } from '../server.js';
const command: CommandModule = {
  command: 'dev',
  describe: 'Watch result files and refresh the performance report automatically',
  builder: (yargs) =>
    yargs
      .option('out', { type: 'string', default: 'performance-results' })
      .option('host', { type: 'string', default: 'localhost' })
      .option('port', { type: 'number', default: 4400, describe: 'Starting port; try higher ports if occupied' }),
  handler: async (args) => {
    const server = await startServer({
      out: args.out as string,
      host: args.host as string,
      port: args.port as number,
      watchResults: true,
      findAvailablePort: true,
    });
    console.log(`Performance development report: ${server.url}\nWatching: ${args.out}`);
    for (const signal of ['SIGINT', 'SIGTERM'] as const)
      process.once(signal, () => {
        void server.close();
      });
  },
};
export default command;
