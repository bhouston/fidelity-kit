import type { SuiteWarning } from './core/index.js';

/** One line per distinct message so a misnamed renderer across hundreds of scenes stays readable. */
export function formatWarnings(warnings: SuiteWarning[], examples = 3): string[] {
  const groups = new Map<string, string[]>();
  for (const { path, message } of warnings) {
    const paths = groups.get(message) ?? [];
    if (!paths.includes(path)) paths.push(path);
    groups.set(message, paths);
  }
  return [...groups].map(([message, paths]) => {
    const shown = paths.slice(0, examples).join(', ');
    const more = paths.length > examples ? ` and ${paths.length - examples} more` : '';
    return `warning: ${shown}${more}: ${message}`;
  });
}

export function printWarnings(warnings: SuiteWarning[]) {
  for (const line of formatWarnings(warnings)) console.warn(line);
}
