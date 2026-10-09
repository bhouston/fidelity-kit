export type CaptureLane = 'cpu' | 'gpu';
/** One job per lane; exclusive jobs take priority over producers capable of either lane. */
export async function runCaptureLanes<T>(
  jobs: readonly T[],
  lanesOf: (job: T) => readonly CaptureLane[],
  run: (job: T, lane: CaptureLane) => Promise<void>,
) {
  const pending = jobs.map((job) => ({ job, lanes: lanesOf(job) }));
  if (pending.some((entry) => entry.lanes.length === 0)) throw new Error('Every capture job needs a lane');
  function take(lane: CaptureLane) {
    let index = pending.findIndex((entry) => entry.lanes.length === 1 && entry.lanes[0] === lane);
    if (index < 0) index = pending.findIndex((entry) => entry.lanes.includes(lane));
    return index < 0 ? undefined : pending.splice(index, 1)[0]!.job;
  }
  let failure: unknown;
  async function worker(lane: CaptureLane) {
    for (let job = take(lane); job !== undefined; job = take(lane)) {
      try {
        await run(job, lane);
      } catch (error) {
        failure ??= error;
        break;
      }
    }
  }
  // Await both lanes before releasing shared resources, including on job failure.
  await Promise.all([worker('gpu'), worker('cpu')]);
  if (failure) throw failure;
}
