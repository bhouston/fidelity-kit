import type { CommandModule } from 'yargs';
import { loadSuite, scanResults } from '../performance/storage.js';
const command: CommandModule = {
  command: 'validate',
  describe: 'Validate a suite or every metrics result',
  builder: (yargs) =>
    yargs
      .option('suite', { type: 'string' })
      .option('results', { type: 'string' })
      .check((args) => {
        if (!!args.suite === !!args.results) throw new Error('Specify exactly one of --suite or --results');
        return true;
      }),
  handler: async (args) => {
    if (args.suite) {
      const suite = await loadSuite(args.suite as string);
      console.log(`Valid suite: ${suite.name} (${suite.entries.length} entries)`);
    } else {
      const index = await scanResults(args.results as string);
      console.log(`Validated ${index.runs.length} results`);
    }
  },
};
export default command;
