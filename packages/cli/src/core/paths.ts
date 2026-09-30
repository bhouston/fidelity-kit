// Client-safe file naming (no node imports): shared by the CLI and the viewer.
export const IMAGE_EXT = '.avif';
/** Preferred source formats, in selection order. */
export const IMAGE_EXTENSIONS = ['.avif', '.webp', '.png', '.jpg'] as const;
export const imageFile = (renderer: string, extension: string = IMAGE_EXT) => `${renderer}${extension}`;
export const isImageFile = (file: string) => IMAGE_EXTENSIONS.some((extension) => file.endsWith(extension));
export const metricsFile = (renderer: string, reference: string) => `${renderer}.vs-${reference}.metrics.json`;
export const deltaFile = (renderer: string, reference: string, extension: '.webp' | '.avif' = '.webp') =>
  `${renderer}.vs-${reference}.delta${extension}`;

/** The only suite files the viewer may read; also what `build` exports and `hash` covers. */
export function isDataFile(rel: string): boolean {
  if (rel.split('/').some((s) => s.startsWith('.') || s === '..')) return false;
  return rel === 'index.json' || rel === 'README.md' || rel.endsWith('/README.md') || isImageFile(rel);
}
