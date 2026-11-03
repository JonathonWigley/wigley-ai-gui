// An image's bytes and the media type they are encoded in.
export interface EncodableImage {
  bytes: Uint8Array;
  mediaType: string;
}

export interface ImageEncoder {
  // Re-encodes `image` scaled by `scale` (0–1] as `mediaType`; rejects when
  // `image` does not decode or the adapter cannot write `mediaType`.
  encode(
    image: EncodableImage,
    scale: number,
    mediaType: string,
  ): Promise<Uint8Array>;
}
