import { z } from 'zod';

const id = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/);
const uniqueIds = <T extends { id: string }>(items: T[]) => new Set(items.map((item) => item.id)).size === items.length;

/** `<root>/fidelity.json`. Renderer/output ids and labels are entirely up to the suite. */
export const configSchema = z.object({
  title: z.string(),
  renderers: z
    .array(
      z.object({
        id,
        label: z.string().optional(),
        reference: z.boolean().optional(),
        category: z.string().optional(),
      }),
    )
    .refine((r) => r.some((x) => x.reference), 'at least one renderer needs "reference": true')
    .refine(uniqueIds, 'renderer ids must be unique'),
  outputs: z
    .array(z.object({ id, label: z.string().optional() }))
    .min(1, 'at least one output is required')
    .refine(uniqueIds, 'output ids must be unique')
    .default([{ id: 'beauty' }]),
});
export type FidelityConfig = z.infer<typeof configSchema>;

/** Optional `<scene>/scene.json`. */
export const sceneMetaSchema = z.object({ title: z.string().optional(), tags: z.array(z.string()).default([]) });
