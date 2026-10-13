import type { RawImage } from './compare.js';
import { gradientEnergy } from './compare.js';

/** Summary of a dynamic (temporal) comparison over the measured frames of a sequence. */
export interface TemporalSummary {
  /** PSNR (dB) of the mean squared error over all measured frames; `null` when identical. */
  psnr: number | null;
  /**
   * PSNR (dB) of the frame-to-frame change, `(test[t] − test[t−1]) − (reference[t] − reference[t−1])`. It isolates
   * flicker, shimmering and lag from a constant spatial error; `null` when the changes are identical.
   */
  temporalPsnr: number | null;
  /** Gradient energy of the test frames relative to the reference frames (1 = equally sharp, < 1 = blurrier). */
  sharpness: number | null;
  /** Number of measured frames. */
  frames: number;
}

export interface TemporalComparison {
  summary: TemporalSummary;
  perFrame: {
    psnr: (number | null)[];
    /** `null` for the first measured frame, which has no predecessor. */
    temporalPsnr: (number | null)[];
    sharpness: (number | null)[];
  };
}

const psnr = (mse: number) => (mse === 0 ? null : 10 * Math.log10((255 * 255) / mse));

/** Compares two equally long sequences of equally sized RGB frames. */
export function compareSequences(reference: RawImage[], test: RawImage[]): TemporalComparison {
  if (reference.length !== test.length) throw new Error(`Frame count mismatch: ${reference.length} vs ${test.length}`);
  if (!reference.length) throw new Error('No frames to compare');
  const perFrame: TemporalComparison['perFrame'] = { psnr: [], temporalPsnr: [], sharpness: [] };
  let squared = 0;
  let temporalSquared = 0;
  let samples = 0;
  let temporalSamples = 0;
  let referenceGradient = 0;
  let testGradient = 0;
  for (let i = 0; i < reference.length; i += 1) {
    const ref = reference[i]!;
    const tst = test[i]!;
    if (ref.width !== tst.width || ref.height !== tst.height)
      throw new Error(`Frame ${i} size mismatch: ${ref.width}x${ref.height} vs ${tst.width}x${tst.height}`);
    const previousRef = reference[i - 1];
    const previousTest = test[i - 1];
    let frameSquared = 0;
    let frameTemporal = 0;
    for (let p = 0; p < ref.data.length; p += 1) {
      const d = tst.data[p]! - ref.data[p]!;
      frameSquared += d * d;
      if (previousRef && previousTest) {
        const t = tst.data[p]! - previousTest.data[p]! - (ref.data[p]! - previousRef.data[p]!);
        frameTemporal += t * t;
      }
    }
    const n = ref.data.length;
    squared += frameSquared;
    samples += n;
    perFrame.psnr.push(psnr(frameSquared / n));
    if (previousRef && previousTest) {
      temporalSquared += frameTemporal;
      temporalSamples += n;
      perFrame.temporalPsnr.push(psnr(frameTemporal / n));
    } else perFrame.temporalPsnr.push(null);
    const refEnergy = gradientEnergy(ref);
    const testEnergy = gradientEnergy(tst);
    referenceGradient += refEnergy;
    testGradient += testEnergy;
    perFrame.sharpness.push(refEnergy === 0 ? null : testEnergy / refEnergy);
  }
  return {
    summary: {
      psnr: psnr(squared / samples),
      temporalPsnr: temporalSamples ? psnr(temporalSquared / temporalSamples) : null,
      sharpness: referenceGradient === 0 ? null : testGradient / referenceGradient,
      frames: reference.length,
    },
    perFrame,
  };
}

/** `<scene>/<output>/<renderer>.temporal.json`: one compared renderer's sequence metrics. */
export interface TemporalRecord {
  schemaVersion: 1;
  scene: string;
  renderer: string;
  reference: string;
  output: string;
  width: number;
  height: number;
  fps: number;
  warmup: number;
  summary: TemporalSummary;
  perFrame: { psnr: (number | null)[]; temporalPsnr: (number | null)[]; sharpness: (number | null)[] };
  generatedAt: string;
}

/** `<root>/dynamic.json`: summaries of every dynamic comparison, keyed by scene path then renderer. */
export interface DynamicIndex {
  schemaVersion: 1;
  output: string;
  reference: string;
  results: Record<string, Record<string, TemporalSummary & { generatedAt: string }>>;
}
