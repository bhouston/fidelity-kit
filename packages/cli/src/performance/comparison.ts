import { stat } from 'node:fs/promises';
import { compareRuns, type ProcessedResult } from '../schema/index.js';
import { scanResults } from './storage.js';
type Axis = 'renderer' | 'scene';
export interface ComparisonGroup {
  runs: ProcessedResult[];
  selectorKey?: Axis;
  directory: boolean;
}
export async function selectComparisonGroup(value: string, root: string): Promise<ComparisonGroup> {
  try {
    if ((await stat(value)).isDirectory())
      return { runs: (await scanResults(value)).runs.map((run) => run.result), directory: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const split = value.indexOf('=');
  const axis = value.slice(0, split);
  if (split < 1 || !['renderer', 'scene'].includes(axis) || !value.slice(split + 1))
    throw new Error(`Comparison selector must be a directory, renderer=<id>, or scene=<id>: ${value}`);
  const selectorKey = axis as Axis;
  return {
    directory: false,
    selectorKey,
    runs: (await scanResults(root)).runs
      .map((run) => run.result)
      .filter((run) => run.entry[selectorKey].id === value.slice(split + 1)),
  };
}
export function compareGroups(
  a: ComparisonGroup,
  b: ComparisonGroup,
  options: { seed?: number; iterations?: number } = {},
) {
  if (!a.runs.length || !b.runs.length) throw new Error('Both comparison groups must contain results');
  if (options.iterations !== undefined && (!Number.isInteger(options.iterations) || options.iterations < 1))
    throw new Error('iterations must be a positive integer');
  if (options.seed !== undefined && !Number.isFinite(options.seed)) throw new Error('seed must be finite');
  const directoryPair = a.directory && b.directory;
  if (!directoryPair && a.selectorKey && b.selectorKey && a.selectorKey !== b.selectorKey)
    throw new Error('Use the same renderer or scene axis for both comparison groups');
  const selectedAxis = a.selectorKey ?? b.selectorKey;
  if (!directoryPair && !selectedAxis) throw new Error('Choose a renderer or scene comparison axis');
  const heldAxis: Axis = selectedAxis === 'renderer' ? 'scene' : 'renderer';
  const keyFor = (run: ProcessedResult) => (directoryPair ? run.entry.id : run.entry[heldAxis].id);
  const collect = (group: ComparisonGroup) => {
    const grouped = new Map<string, ProcessedResult[]>();
    for (const run of group.runs) {
      const key = keyFor(run);
      grouped.set(key, [...(grouped.get(key) ?? []), run]);
    }
    if (!directoryPair)
      for (const [key, runs] of grouped)
        if (new Set(runs.map((run) => run.entry.id)).size > 1)
          throw new Error(
            `Ambiguous ${heldAxis} ${key}: select one renderer configuration and scene per workload, or compare result directories`,
          );
    return grouped;
  };
  const left = collect(a),
    right = collect(b),
    comparisons = [];
  for (const [workload, runsA] of left) {
    const runsB = right.get(workload);
    if (!runsB) continue;
    comparisons.push({
      workload: directoryPair ? workload : `${heldAxis}=${workload}`,
      entryA: runsA[0]!.entry.id,
      entryB: runsB[0]!.entry.id,
      ...compareRuns(runsA, runsB, options),
    });
  }
  if (!comparisons.length) throw new Error('No matching workload entries between comparison groups');
  return comparisons;
}
