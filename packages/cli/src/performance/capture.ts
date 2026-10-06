import sharp from 'sharp';

/** Match ss-fidelity result captures: opaque AVIF with full chroma resolution. */
export const RESULT_AVIF = { quality: 90, chromaSubsampling: '4:4:4' } as const;

/** Browser transport stays PNG; encode only after the measured window closes. */
export async function encodeCapture(png: Uint8Array): Promise<Buffer> {
  return sharp(png).removeAlpha().avif(RESULT_AVIF).toBuffer();
}
