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
        params,
        command: z.array(z.string()).optional(),
      }),
    )
    .min(1),
  scenes: z
    .array(
      z.object({
        ...identity,
        path: z.string().optional(),
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
