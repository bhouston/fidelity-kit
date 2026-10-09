import { z } from 'zod';
import type { Suite } from './schema/index.js';

const id = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/);
const params = z.record(z.string(), z.unknown()).default({});
const identity = { id, name: z.string().min(1) };
export const registrySchema = z.object({
  schemaVersion: z.literal(1),
  title: z.string().min(1),
  home: z.object({ hero: z.object({ scene: id, renderer: id, output: id.default('beauty') }).optional() }).default({}),
  renderServer: z.object({
    developmentUrl: z.url(),
    deployedUrl: z.url().optional(),
    entry: z.string().default('performance.html'),
  }),
  renderers: z
    .array(
      z.object({
        ...identity,
        legacyIds: z.array(id).default([]),
        kind: z.enum(['browser', 'external']).default('browser'),
        reference: z.boolean().default(false),
        enabled: z.boolean().default(true),
        category: z.string().min(1).optional(),
        params,
        command: z.array(z.string()).optional(),
        captureLane: z.enum(['cpu', 'gpu', 'either']).optional(),
      }),
    )
    .min(1),
  scenes: z
    .array(
      z.object({
        ...identity,
        path: z.string().optional(),
        externalCaptureLane: z.enum(['cpu', 'gpu']).optional(),
        category: z.string().min(1).optional(),
        tags: z.array(z.string()).optional(),
        params,
        fidelity: z
          .object({
            width: z.number().int().positive().default(640),
            height: z.number().int().positive().default(480),
            frames: z.number().int().positive().default(64),
          })
          .default({ width: 640, height: 480, frames: 64 }),
      }),
    )
    .min(1),
  comparisonPresets: z
    .array(z.object({ id, name: z.string().min(1), renderers: z.array(id), ref: id.optional() }))
    .optional(),
  performance: z
    .record(
      z.string(),
      z.object({
        defaults: z.record(z.string(), z.unknown()).optional(),
        entries: z.array(
          z.object({
            renderer: id,
            scene: id,
            durationMs: z.number().positive().default(10000),
            params,
            reference: z
              .object({ image: z.string(), targetPsnr: z.number().optional(), intervalMs: z.number().optional() })
              .optional(),
          }),
        ),
      }),
    )
    .default({}),
});
export type RenderingRegistry = z.infer<typeof registrySchema>;
export function parseRegistry(value: unknown): RenderingRegistry {
  const suite = registrySchema.parse(value);
  for (const key of ['renderers', 'scenes'] as const) {
    const ids = suite[key].map((item) => item.id);
    if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${key} IDs`);
  }
  const rendererIdentities = new Map(suite.renderers.map((renderer) => [renderer.id, renderer.id]));
  for (const renderer of suite.renderers)
    for (const alias of renderer.legacyIds) {
      const owner = rendererIdentities.get(alias);
      if (owner && owner !== renderer.id) throw new Error(`Ambiguous renderer identity ${alias}`);
      rendererIdentities.set(alias, renderer.id);
    }
  for (const preset of suite.comparisonPresets ?? []) {
    if (preset.renderers.some((rendererId) => !suite.renderers.some((r) => r.id === rendererId)))
      throw new Error(`Unknown renderer in preset ${preset.id}`);
    if (preset.ref && !suite.renderers.some((r) => r.id === preset.ref && r.reference))
      throw new Error(`Invalid reference in preset ${preset.id}`);
  }
  if (new Set(suite.comparisonPresets?.map((p) => p.id)).size !== (suite.comparisonPresets?.length ?? 0))
    throw new Error('Duplicate comparison preset IDs');
  for (const renderer of suite.renderers)
    if (renderer.kind === 'browser' && renderer.captureLane && renderer.captureLane !== 'gpu')
      throw new Error('Browser captures require the GPU lane');
  const hero = suite.home.hero;
  if (
    hero &&
    (!suite.scenes.some((scene) => scene.id === hero.scene) ||
      !suite.renderers.some((renderer) => renderer.id === hero.renderer))
  )
    throw new Error('Home hero must identify a registered renderer and scene');
  for (const [name, collection] of Object.entries(suite.performance))
    for (const entry of collection.entries) {
      const renderer = suite.renderers.find((r) => r.id === entry.renderer);
      if (!renderer || renderer.kind !== 'browser')
        throw new Error(`Unknown browser renderer ${entry.renderer} in ${name}`);
      if (!suite.scenes.some((s) => s.id === entry.scene)) throw new Error(`Unknown scene ${entry.scene} in ${name}`);
    }
  for (const renderer of suite.renderers)
    if (renderer.kind === 'external' && !renderer.command?.length)
      throw new Error(`External renderer ${renderer.id} needs a command`);
  return suite;
}
/** Local and deployed roots are infrastructure, never part of renderer/scene identity. */
export function rendererUrl(suite: RenderingRegistry, mode: 'development' | 'deployed', override?: string): URL {
  const root =
    override ?? (mode === 'development' ? suite.renderServer.developmentUrl : suite.renderServer.deployedUrl);
  if (!root) throw new Error('Configure renderServer.deployedUrl or pass --root-url for a deployed site');
  const url = new URL(root);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Render server must use HTTP or HTTPS');
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return new URL(suite.renderServer.entry, url);
}
export function rendererParams(suite: RenderingRegistry, rendererId: string, sceneId: string) {
  const renderer = suite.renderers.find((r) => r.id === rendererId);
  const scene = suite.scenes.find((s) => s.id === sceneId);
  if (!renderer || !scene) throw new Error('Unknown renderer or scene');
  return { ...scene.params, ...renderer.params, scene: scene.id };
}
export function performanceSuite(suite: RenderingRegistry, collection = 'default'): Suite {
  const selected = suite.performance[collection];
  if (!selected) throw new Error(`Unknown performance collection ${collection}`);
  return {
    schemaVersion: 1,
    name: `${suite.title} / ${collection}`,
    defaults: selected.defaults as Suite['defaults'],
    entries: selected.entries.map((entry) => {
      const renderer = suite.renderers.find((r) => r.id === entry.renderer)!;
      const scene = suite.scenes.find((s) => s.id === entry.scene)!;
      return {
        id: `${scene.id}--${renderer.id}`,
        name: `${renderer.name} · ${scene.name}`,
        renderer: { id: renderer.id, name: renderer.name },
        scene: { id: scene.id, name: scene.name },
        url: suite.renderServer.entry,
        durationMs: entry.durationMs,
        params: { ...rendererParams(suite, renderer.id, scene.id), width: 1920, height: 1080, ...entry.params },
        ...(entry.reference
          ? { reference: entry.reference as NonNullable<Suite['entries'][number]['reference']> }
          : {}),
      };
    }),
  };
}
