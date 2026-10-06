import type { CommandModule } from 'yargs';
import { compareGroups, selectComparisonGroup } from '../performance/comparison.js';
const command: CommandModule = {
  command: 'compare',
  describe: 'Compare matching workloads using run-level bootstrap confidence intervals',
  builder: (yargs) =>
    yargs
      .option('a', { type: 'string', demandOption: true })
      .option('b', { type: 'string', alias: 'baseline', demandOption: true })
      .option('out', { type: 'string', default: 'performance-results' })
      .option('seed', { type: 'number', default: 1 })
      .option('iterations', { type: 'number', default: 2000 })
      .option('json', { type: 'boolean', default: false })
      .option('regression-threshold', {
        type: 'number',
        describe: 'Fail any workload whose A/B CI exceeds 1 + threshold (fraction)',
      })
      .check((args) => {
        if (
          typeof args.regressionThreshold === 'number' &&
          (!Number.isFinite(args.regressionThreshold) || args.regressionThreshold < 0)
        )
          throw new Error('regression-threshold must be finite and nonnegative');
        return true;
      }),
  handler: async (args) => {
    const [a, b] = await Promise.all([
      selectComparisonGroup(args.a as string, args.out as string),
      selectComparisonGroup(args.b as string, args.out as string),
    ]);
    const comparisons = compareGroups(a, b, { seed: args.seed as number, iterations: args.iterations as number });
    if (args.json) console.log(JSON.stringify(comparisons.length === 1 ? comparisons[0] : { comparisons }, null, 2));
    else
      for (const comparison of comparisons)
        console.log(
          `${comparison.workload}\nA ${comparison.medianA.toFixed(3)} ms; B ${comparison.medianB.toFixed(3)} ms\nA/B ${comparison.ratio.toFixed(3)} (95% CI ${comparison.confidenceInterval.map((v) => v.toFixed(3)).join('–')}); ${comparison.verdict}\nMann-Whitney U=${comparison.u.toFixed(1)}, p=${comparison.pValue.toPrecision(3)}`,
        );
    if (
      typeof args.regressionThreshold === 'number' &&
      comparisons.some((comparison) => comparison.confidenceInterval[0] > 1 + (args.regressionThreshold as number))
    )
      process.exitCode = 1;
  },
};
export default command;
