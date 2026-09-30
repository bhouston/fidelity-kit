import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { SuiteIndex } from '@fidelity-kit/core';

/** The results directory (contains fidelity.json + index.json from `fidelity process`). */
export function suiteRoot(): string {
  const root = process.env.FIDELITY_ROOT;
  if (!root) throw new Error('Set FIDELITY_ROOT to the suite results directory.');
  return resolve(root);
}

let cached: { mtimeMs: number; index: SuiteIndex } | undefined;

/** index.json, re-read only when its mtime changes. */
export async function readIndex(): Promise<SuiteIndex> {
  const file = join(suiteRoot(), 'index.json');
  const s = await stat(file).catch(() => null);
  if (!s) throw new Error(`No index.json in ${suiteRoot()}. Run \`fidelity process <root>\` first.`);
  if (cached?.mtimeMs !== s.mtimeMs) cached = { mtimeMs: s.mtimeMs, index: JSON.parse(await readFile(file, 'utf8')) };
  return cached.index;
}

/** README.md of the suite ('' path) or of a group/scene; undefined when absent. */
export async function readReadme(path: string): Promise<string | undefined> {
  if (path.split('/').some((s) => s === '..')) return undefined;
  return readFile(join(suiteRoot(), path, 'README.md'), 'utf8').catch(() => undefined);
}
