// Client-safe file naming (no node imports): shared by the CLI and the viewer.
export const IMAGE_EXT = '.avif';
export const imageFile = (renderer: string) => `${renderer}${IMAGE_EXT}`;
export const metricsFile = (renderer: string, reference: string) => `${renderer}.vs-${reference}.metrics.json`;
export const deltaFile = (renderer: string, reference: string) => `${renderer}.vs-${reference}.delta${IMAGE_EXT}`;
