import type { ProgressCallback, ProgressUpdate } from './core/progress.js';

export interface ProgressStream {
  isTTY?: boolean;
  columns?: number;
  write(text: string): unknown;
}

/** A single terminal line, throttled across phase changes and file completions. */
export function createProgress(
  label: string,
  quiet = false,
  stream: ProgressStream = process.stdout,
  now: () => number = Date.now,
): { update: ProgressCallback; finish: () => void } {
  let phase = '';
  let phaseStart = 0;
  let lastWrite = -Infinity;
  let showing = false;

  const update = (status: ProgressUpdate) => {
    if (quiet || !stream.isTTY) return;
    const time = now();
    if (status.phase !== phase) {
      phase = status.phase;
      phaseStart = time;
    }
    if (time - lastWrite < 1000) return;
    const remaining = Math.max(0, status.total - status.completed);
    const elapsed = time - phaseStart;
    const eta =
      status.completed > 0 && elapsed >= 1000 && remaining > 0
        ? `, ETA ~${formatDuration((elapsed / status.completed) * remaining)}`
        : '';
    const line = `${label}: ${phase} ${status.completed}/${status.total} ${status.unit} (${remaining} remaining${eta})`;
    stream.write(`\r\x1b[2K${line.slice(0, Math.max(0, (stream.columns ?? Infinity) - 1))}`);
    lastWrite = time;
    showing = true;
  };

  return {
    update,
    finish: () => {
      if (showing) stream.write('\r\x1b[2K');
      showing = false;
      phase = '';
    },
  };
}

function formatDuration(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.ceil(minutes / 60)}h`;
}
