// The canvas adapter behind ImageEncoder: decodes the image (a GIF to its
// first frame), draws it scaled, and encodes the drawing.
import type { EncodableImage, ImageEncoder } from './shrink-image';

const QUALITY = 0.9;

export const canvasEncoder: ImageEncoder = {
  async encode(
    image: EncodableImage,
    scale: number,
    mediaType: string,
  ): Promise<Uint8Array> {
    const bitmap = await createImageBitmap(
      new Blob([new Uint8Array(image.bytes)], { type: image.mediaType }),
    );
    try {
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d');
      if (context === null) {
        throw new Error('No 2D canvas to shrink the image');
      }
      context.drawImage(bitmap, 0, 0, width, height);
      // The canvas ignores quality for PNG.
      const blob = await canvas.convertToBlob({
        type: mediaType,
        quality: QUALITY,
      });
      return new Uint8Array(await blob.arrayBuffer());
    } finally {
      bitmap.close();
    }
  },
};
