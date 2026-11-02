// Shrinks an image over the API's cap by re-encoding it smaller, behind an
// encoder seam so the step-down rule runs without a canvas.
import {
  IMAGE_TYPES,
  MAX_IMAGE_BASE64,
  base64LengthOf,
} from '../../image-types';

export interface EncodableImage {
  bytes: Uint8Array;
  mediaType: string;
}

export interface ImageEncoder {
  // Re-encodes `image` scaled by `scale` (0–1] as `mediaType`.
  encode(
    image: EncodableImage,
    scale: number,
    mediaType: string,
  ): Promise<Uint8Array>;
}

const STEPS = 6;
const STEP_SCALE = 0.75;

// `image` itself when its base64 text is within MAX_IMAGE_BASE64; else the
// first of six ever smaller re-encodings of the original that fits, or null
// when none does or the type cannot be re-encoded. An encoder rejection
// rejects this too.
export async function shrinkToFit(
  image: EncodableImage,
  encoder: ImageEncoder,
): Promise<EncodableImage | null> {
  if (fits(image.bytes)) {
    return image;
  }
  if (!IMAGE_TYPES.includes(image.mediaType)) {
    return null;
  }
  const mediaType = outputTypeOf(image.mediaType);
  for (let step = 1; step <= STEPS; step += 1) {
    const bytes = await encoder.encode(image, STEP_SCALE ** step, mediaType);
    if (fits(bytes)) {
      return { bytes, mediaType };
    }
  }
  return null;
}

function fits(bytes: Uint8Array): boolean {
  return base64LengthOf(bytes.length) <= MAX_IMAGE_BASE64;
}

// JPEG and WebP re-encode as themselves; PNG and GIF (its first frame) as PNG.
function outputTypeOf(mediaType: string): string {
  const keepsItsType = mediaType === 'image/jpeg' || mediaType === 'image/webp';
  return keepsItsType ? mediaType : 'image/png';
}
