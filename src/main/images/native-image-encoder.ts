// The native image adapter behind ImageEncoder: decodes the image, resizes it,
// and encodes it as PNG or JPEG, the two types Electron's nativeImage writes.
import { nativeImage } from 'electron';
import type { EncodableImage, ImageEncoder } from '../../contracts/images';

const JPEG_QUALITY = 90;

export const nativeImageEncoder: ImageEncoder = {
  encode(
    image: EncodableImage,
    scale: number,
    mediaType: string,
  ): Promise<Uint8Array> {
    const decoded = nativeImage.createFromBuffer(Buffer.from(image.bytes));
    if (decoded.isEmpty()) {
      return Promise.reject(
        new Error(`Could not decode the ${image.mediaType} image`),
      );
    }
    const size = decoded.getSize();
    const resized = decoded.resize({
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale)),
      quality: 'best',
    });
    switch (mediaType) {
      case 'image/png':
        return Promise.resolve(new Uint8Array(resized.toPNG()));
      case 'image/jpeg':
        return Promise.resolve(new Uint8Array(resized.toJPEG(JPEG_QUALITY)));
      default:
        return Promise.reject(
          new Error(`No native encoder writes ${mediaType}`),
        );
    }
  },
};
