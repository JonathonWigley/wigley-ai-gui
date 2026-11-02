import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_BASE64 } from '../../image-types';
import {
  shrinkToFit,
  type EncodableImage,
  type ImageEncoder,
} from './shrink-image';

// The most bytes whose base64 text fits the cap.
const CAP_BYTES = (MAX_IMAGE_BASE64 / 4) * 3;

interface EncodeCall {
  scale: number;
  mediaType: string;
}

// Records each call, and returns `bytesFor` the original length and scale;
// by default the area shrinks as the square of the scale.
function fakeEncoder(
  bytesFor: (length: number, scale: number) => number = (length, scale) =>
    Math.round(length * scale * scale),
): ImageEncoder & { calls: EncodeCall[] } {
  const calls: EncodeCall[] = [];
  return {
    calls,
    encode(image, scale, mediaType) {
      calls.push({ scale, mediaType });
      return Promise.resolve(
        new Uint8Array(bytesFor(image.bytes.length, scale)),
      );
    },
  };
}

function imageOf(byteCount: number, mediaType: string): EncodableImage {
  return { bytes: new Uint8Array(byteCount), mediaType };
}

const SIX_SCALES = [
  0.75, 0.5625, 0.421875, 0.31640625, 0.2373046875, 0.177978515625,
];

describe('shrinkToFit', () => {
  it('leaves an image within the cap as it is', async () => {
    const image = imageOf(CAP_BYTES, 'image/png');
    const encoder = fakeEncoder();
    expect(await shrinkToFit(image, encoder)).toBe(image);
    expect(encoder.calls).toEqual([]);
  });

  it.each([
    {
      byteCount: CAP_BYTES + 1,
      mediaType: 'image/png',
      outType: 'image/png',
      scales: [0.75],
    },
    {
      byteCount: 8_000_000,
      mediaType: 'image/jpeg',
      outType: 'image/jpeg',
      scales: [0.75, 0.5625],
    },
    {
      byteCount: 8_000_000,
      mediaType: 'image/gif',
      outType: 'image/png',
      scales: [0.75, 0.5625],
    },
    {
      byteCount: 8_000_000,
      mediaType: 'image/webp',
      outType: 'image/webp',
      scales: [0.75, 0.5625],
    },
  ])(
    'steps down until the image fits: $byteCount bytes $mediaType → $outType',
    async ({ byteCount, mediaType, outType, scales }) => {
      const encoder = fakeEncoder();
      const shrunk = await shrinkToFit(imageOf(byteCount, mediaType), encoder);
      const lastScale = scales[scales.length - 1];
      expect({
        length: shrunk?.bytes.length,
        mediaType: shrunk?.mediaType,
      }).toEqual({
        length: Math.round(byteCount * lastScale * lastScale),
        mediaType: outType,
      });
      expect(encoder.calls).toEqual(
        scales.map((scale) => ({ scale, mediaType: outType })),
      );
    },
  );

  it('refuses an image still over the cap after six steps', async () => {
    const encoder = fakeEncoder(() => 4_000_000);
    expect(
      await shrinkToFit(imageOf(4_000_000, 'image/png'), encoder),
    ).toBeNull();
    expect(encoder.calls.map(({ scale }) => scale)).toEqual(SIX_SCALES);
  });

  it('refuses an over-cap type it cannot re-encode', async () => {
    const encoder = fakeEncoder();
    expect(
      await shrinkToFit(imageOf(4_000_000, 'image/bmp'), encoder),
    ).toBeNull();
    expect(encoder.calls).toEqual([]);
  });

  it('passes an encoder rejection on', async () => {
    const encoder: ImageEncoder = {
      encode: () => Promise.reject(new Error('bad image')),
    };
    await expect(
      shrinkToFit(imageOf(4_000_000, 'image/png'), encoder),
    ).rejects.toThrow('bad image');
  });
});
