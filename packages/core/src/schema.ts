import { z } from 'zod';

const id = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/);

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
    .refine((r) => r.some((x) => x.reference), 'at least one renderer needs "reference": true'),
  outputs: z.array(z.object({ id, label: z.string().optional() })).default([{ id: 'beauty' }]),
  delta: z.boolean().default(true),
});
export type FidelityConfig = z.infer<typeof configSchema>;

/** Optional `<scene>/scene.json`. */
export const sceneMetaSchema = z.object({ title: z.string().optional(), tags: z.array(z.string()).default([]) });

export const IMAGE_EXT = '.avif';
export const imageFile = (renderer: string) => `${renderer}${IMAGE_EXT}`;
export const metricsFile = (renderer: string, reference: string) => `${renderer}.vs-${reference}.metrics.json`;
export const deltaFile = (renderer: string, reference: string) => `${renderer}.vs-${reference}.delta${IMAGE_EXT}`;
