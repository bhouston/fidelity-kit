import type { RenderSession } from './host.js';

/** Bounded batches avoid queue flooding and per-frame timers, queries, or GPU fences. */
export async function measureThroughput(
  session: Pick<RenderSession, 'draw' | 'complete'>,
  options: {
    durationMs: number;
    warmupMs?: number;
    batchSize?: number;
    start(): void;
    batch(completedFrames: number): void;
    end(completedFrames: number): void;
    stopped?(): boolean;
    now?: () => number;
  },
): Promise<void> {
  const now = options.now ?? (() => performance.now());
  const batchSize = options.batchSize ?? 16;
  const warmupMs = options.warmupMs ?? 1000;
  if (
    !Number.isFinite(options.durationMs) ||
    options.durationMs <= 0 ||
    !Number.isFinite(warmupMs) ||
    warmupMs < 0 ||
    !Number.isSafeInteger(batchSize) ||
    batchSize < 1
  )
    throw new Error('Invalid throughput measurement bounds');
  const batch = async () => {
    for (let i = 0; i < batchSize; i++) session.draw();
    await session.complete();
    // WebGL finish() can resolve synchronously; yield so aborts and browser events run.
    await new Promise<void>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        channel.port2.close();
        resolve();
      };
      channel.port2.postMessage(null);
    });
  };
  try {
    const warmupStart = now();
    while (now() - warmupStart < warmupMs && !options.stopped?.()) await batch();
    await session.complete();
    if (options.stopped?.()) return;
    options.start();
    const start = now();
    let completedFrames = 0;
    while (now() - start < options.durationMs && !options.stopped?.()) {
      await batch();
      completedFrames += batchSize;
      options.batch(completedFrames);
    }
    if (!options.stopped?.()) options.end(completedFrames);
  } finally {
    // Drain all submitted rendering work even when drawing fails or the run is aborted.
    await session.complete();
  }
}
