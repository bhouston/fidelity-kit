import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';

/** Normalize once before measurement; preserve RGB exactly in portable PNG assets. */
export async function loadReference(image: string, suiteFile: string): Promise<Uint8Array> {
  let bytes: Uint8Array;
  if (/^https?:\/\//i.test(image)) {
    const response = await fetch(image);
    if (!response.ok) throw new Error(`Reference request failed: ${response.status} ${image}`);
    bytes = new Uint8Array(await response.arrayBuffer());
  } else {
    if (/^[a-z][a-z0-9+.-]*:/i.test(image)) throw new Error('Reference must be a local path or HTTP(S) URL');
    bytes = await readFile(resolve(dirname(suiteFile), image));
  }
  return sharp(bytes).rotate().flatten({ background: '#000000' }).toColourspace('srgb').png().toBuffer();
}

const rgb = (input: Uint8Array) =>
  sharp(input)
    .flatten({ background: '#000000' })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

/** Final diff is computed after measurement, before lossy screenshot encoding. */
export async function referenceDiff(reference: Uint8Array, capture: Uint8Array): Promise<Uint8Array> {
  const [a, b] = await Promise.all([rgb(reference), rgb(capture)]);
  if (a.info.width !== b.info.width || a.info.height !== b.info.height)
    throw new Error('Final convergence capture dimensions differ from the reference');
  const pixels = Buffer.alloc(a.data.length);
  for (let i = 0; i < pixels.length; i++) pixels[i] = Math.min(255, Math.abs(a.data[i]! - b.data[i]!) * 4);
  return sharp(pixels, { raw: { width: a.info.width, height: a.info.height, channels: 3 } })
    .png()
    .toBuffer();
}
