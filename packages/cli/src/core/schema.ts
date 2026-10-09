import { readFileSync } from 'node:fs';
import { Ajv, type AnySchemaObject, type ErrorObject, type ValidateFunction } from 'ajv';

/**
 * The published JSON Schemas in `schemas/` are the source of truth; these types mirror them. Suites can reference the
 * same files from `$schema` for editor validation, or validate in their own tooling.
 */
export const schemaFiles = {
  config: new URL('../../schemas/fidelity.schema.json', import.meta.url),
  scene: new URL('../../schemas/scene.schema.json', import.meta.url),
} as const;

/** `<root>/fidelity.json`. Renderer/output ids and labels are entirely up to the suite. */
export type FidelityConfig = {
  title: string;
  logo?: string;
  renderers: {
    id: string;
    label?: string;
    reference?: boolean;
    /** `false` hides the renderer by default; viewers can still toggle it on. */
    enabled?: boolean;
    category?: string;
  }[];
  comparisonPresets?: { id: string; name: string; renderers: string[]; ref?: string }[];
  outputs: { id: string; label?: string }[];
};

/** Optional `<scene>/scene.json`. */
export type SceneMeta = { title?: string; category?: string; tags: string[] };

/** Something in the suite that fidelity-kit ignores; `path` is relative to the suite root. */
export type SuiteWarning = { path: string; message: string };

export class SchemaValidationError extends Error {
  constructor(
    readonly file: string,
    readonly issues: string[],
  ) {
    super(`Invalid ${file}:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'SchemaValidationError';
  }
}

let ajv: Ajv | undefined;
const validators = new Map<keyof typeof schemaFiles, ValidateFunction>();

function validator(kind: keyof typeof schemaFiles): ValidateFunction {
  let compiled = validators.get(kind);
  if (!compiled) {
    // `errorMessage` follows the ajv-errors convention so other Ajv users get the same friendly messages.
    ajv ??= new Ajv({ allErrors: true, useDefaults: true, verbose: true, keywords: ['errorMessage'] });
    compiled = ajv.compile(JSON.parse(readFileSync(schemaFiles[kind], 'utf8')) as AnySchemaObject);
    validators.set(kind, compiled);
  }
  return compiled;
}

const describePath = (pointer: string) => pointer.replace(/^\//, '').replaceAll('/', '.') || '(root)';

function message(error: ErrorObject): string {
  const custom = (error.parentSchema as { errorMessage?: unknown } | undefined)?.errorMessage;
  if (typeof custom === 'string') return custom;
  if (error.keyword === 'required') return `missing required property "${error.params.missingProperty}"`;
  return error.message ?? 'is invalid';
}

/**
 * Validate parsed JSON in place: defaults are applied and unknown properties are removed with a warning, so typos are
 * visible without breaking suites that carry extra keys. Every other violation throws.
 */
function validate<T>(
  kind: keyof typeof schemaFiles,
  file: string,
  data: unknown,
  onWarning?: (w: SuiteWarning) => void,
) {
  const check = validator(kind);
  if (check(data)) return data as T;
  const issues: string[] = [];
  for (const error of check.errors ?? []) {
    // Failed `contains` candidates are summarized by the `contains` error itself.
    if (error.schemaPath.includes('/contains/')) continue;
    if (error.keyword === 'additionalProperties') {
      const property = error.params.additionalProperty as string;
      delete (error.data as Record<string, unknown>)[property];
      const where = error.instancePath ? `${describePath(error.instancePath)}.${property}` : property;
      onWarning?.({ path: file, message: `unknown property "${where}" is ignored` });
    } else {
      issues.push(`${describePath(error.instancePath)}: ${message(error)}`);
    }
  }
  if (!issues.length && check(data)) return data as T;
  throw new SchemaValidationError(file, [...new Set(issues)]);
}

const duplicates = (items: { id: string }[]) => {
  const seen = new Set<string>();
  return [...new Set(items.filter(({ id }) => seen.has(id) || !seen.add(id)).map(({ id }) => id))];
};

/** Validate `fidelity.json` (already parsed). `file` names it in messages. */
export function parseConfig(data: unknown, file = 'fidelity.json', onWarning?: (w: SuiteWarning) => void) {
  const config = validate<FidelityConfig>('config', file, data, onWarning);
  // JSON Schema cannot express uniqueness by property.
  const issues = [
    ...duplicates(config.renderers).map((id) => `renderers: renderer ids must be unique ("${id}" is repeated)`),
    ...duplicates(config.outputs).map((id) => `outputs: output ids must be unique ("${id}" is repeated)`),
  ];
  issues.push(...duplicates(config.comparisonPresets ?? []).map((id) => `comparisonPresets: duplicate id ${id}`));
  for (const preset of config.comparisonPresets ?? []) {
    if (preset.renderers.some((id) => !config.renderers.some((r) => r.id === id)))
      issues.push(`comparisonPresets: unknown renderer in ${preset.id}`);
    if (preset.ref && !config.renderers.some((r) => r.id === preset.ref && r.reference))
      issues.push(`comparisonPresets: invalid reference in ${preset.id}`);
  }
  if (issues.length) throw new SchemaValidationError(file, issues);
  delete (config as { $schema?: string }).$schema;
  delete (config as { delta?: unknown }).delta;
  return config;
}

/** Validate a scene's `scene.json` (already parsed). `file` names it in messages. */
export function parseSceneMeta(data: unknown, file = 'scene.json', onWarning?: (w: SuiteWarning) => void) {
  const meta = validate<SceneMeta>('scene', file, data, onWarning);
  delete (meta as { $schema?: string }).$schema;
  return meta;
}
