import type { CommandModule } from 'yargs';
import { buildReport } from '../storage.js';
const command: CommandModule = {
  command: 'build',
  describe: 'Build a portable static performance report',
  builder: (yargs) =>
    yargs
      .option('out', { type: 'string', default: 'performance-results' })
      .option('site', { type: 'string', demandOption: true }),
  handler: async (args) => {
    await buildReport(args.out as string, args.site as string);
    console.log(`Report written to ${args.site}`);
  },
};
export default command;
