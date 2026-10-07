import { matchesGlob } from 'node:path';

/** Match comma-separated ID globs in registry order, ignoring commas inside glob groups. */
export function selectNames(names: readonly string[], patterns: string, kind: string): string[] {
  const globs: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= patterns.length; i++) {
    const char = patterns[i];
    if (char && '{[('.includes(char)) depth++;
    if (char && '}])'.includes(char)) depth--;
    if (i === patterns.length || (char === ',' && depth === 0)) {
      const glob = patterns.slice(start, i).trim();
      if (glob) globs.push(glob);
      start = i + 1;
    }
  }
  if (!globs.length) throw new Error(`No ${kind} glob supplied`);
  for (const glob of globs) {
    if (!names.some((name) => matchesGlob(name, glob)))
      throw new Error(`No ${kind} matches "${glob}". Available: ${names.join(', ')}`);
  }
  return names.filter((name) => globs.some((glob) => matchesGlob(name, glob)));
}
