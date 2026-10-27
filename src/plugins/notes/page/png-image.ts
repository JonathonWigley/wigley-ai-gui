// The PNG bytes of an image `blob`: a PNG's own bytes unchanged, any other
// type drawn at its own size and read back as a PNG.
export async function toPngBytes(blob: Blob): Promise<Uint8Array> {
  if (blob.type === 'image/png') {
    return new Uint8Array(await blob.arrayBuffer());
  }
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (context === null) {
      throw new Error('No 2D canvas to convert the image');
    }
    context.drawImage(bitmap, 0, 0);
    const png = await canvas.convertToBlob({ type: 'image/png' });
    return new Uint8Array(await png.arrayBuffer());
  } finally {
    bitmap.close();
  }
}
