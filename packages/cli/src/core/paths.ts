// Client-safe file naming (no node imports): shared by the CLI and the viewer.
/** Default extension for generated result images. */
export const IMAGE_EXT = '.avif';
/** Preferred source formats, in selection order. */
export const IMAGE_EXTENSIONS = ['.avif', '.webp', '.png', '.jpg'] as const;
/** File name of a renderer's image inside an output folder, for example `my-renderer.avif`. */
export const imageFile = (renderer: string, extension: string = IMAGE_EXT) => `${renderer}${extension}`;
/** True for the supported source image extensions. */
export const isImageFile = (file: string) => IMAGE_EXTENSIONS.some((extension) => file.endsWith(extension));
/** Name of the metrics JSON for a renderer compared against a reference. */
export const metricsFile = (renderer: string, reference: string) => `${renderer}.vs-${reference}.metrics.json`;
/** Sidecar of a compared renderer's dynamic (temporal) metrics, next to its representative frame. */
export const temporalFile = (renderer: string) => `${renderer}.temporal.json`;
/** Suite-level index of dynamic fidelity results. */
export const DYNAMIC_INDEX = 'dynamic.json';
/** Name of the delta heatmap for a renderer compared against a reference. */
export const deltaFile = (renderer: string, reference: string, extension: '.webp' | '.avif' = '.webp') =>
  `${renderer}.vs-${reference}.delta${extension}`;

/**
 * The only suite files the viewer may read; also what `build` exports and `hash` covers.
 *
 * @param rel - Path relative to the suite root.
 */
export function isDataFile(rel: string): boolean {
  if (rel.split('/').some((s) => s.startsWith('.') || s === '..')) return false;
  if (rel.startsWith('performance/'))
    return /^(?:performance\/index\.json|performance\/README\.md|performance\/[^/]+\/[^/]+\/[^/]+\/(?:metrics\.json|screenshot\.avif|reference\.png|diff\.png))$/.test(
      rel,
    );
  return (
    rel === 'site.json' ||
    rel === 'index.json' ||
    rel === DYNAMIC_INDEX ||
    rel.endsWith('.temporal.json') ||
    rel === 'README.md' ||
    rel.endsWith('/README.md') ||
    isLogoFile(rel)
  );
}

/** Supported local branding assets, independent of renderer input formats. */
export const isLogoFile = (file: string) => isImageFile(file) || file.endsWith('.svg') || file.endsWith('.ico');
/** Viewer URL of a suite file such as a logo, with each path segment encoded. */
export const logoUrl = (path: string) => `data/${path.split('/').map(encodeURIComponent).join('/')}`;
