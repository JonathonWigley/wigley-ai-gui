import { describe, expect, it } from 'vitest';
import { base64LengthOf, base64Of, extensionOf } from './image-types';

describe('extensionOf', () => {
  it.each([
    { mediaType: 'image/png', extension: 'png' },
    { mediaType: 'image/jpeg', extension: 'jpg' },
    { mediaType: 'image/gif', extension: 'gif' },
    { mediaType: 'image/webp', extension: 'webp' },
    { mediaType: 'image/svg+xml', extension: 'svg' },
    { mediaType: 'application/pdf', extension: 'pdf' },
    { mediaType: 'video/mp4', extension: 'mp4' },
    { mediaType: 'text/plain', extension: 'txt' },
    { mediaType: 'text/plain;charset=utf-8', extension: 'txt' },
    { mediaType: 'text/markdown', extension: 'md' },
    { mediaType: 'application/octet-stream', extension: 'bin' },
    { mediaType: '', extension: 'bin' },
    { mediaType: 'nonsense', extension: 'bin' },
  ])(
    "names a file's extension by its media type: '$mediaType' → $extension",
    ({ mediaType, extension }) => {
      expect(extensionOf(mediaType)).toBe(extension);
    },
  );
});

describe('base64LengthOf', () => {
  it.each([
    { byteCount: 0, length: 0 },
    { byteCount: 1, length: 4 },
    { byteCount: 3, length: 4 },
    { byteCount: 4, length: 8 },
    { byteCount: 3_932_160, length: 5_242_880 },
  ])(
    'measures base64 text: $byteCount bytes → $length',
    ({ byteCount, length }) => {
      expect(base64LengthOf(byteCount)).toBe(length);
    },
  );
});

describe('base64Of', () => {
  it.each([
    { bytes: [1, 2, 3], text: 'AQID' },
    { bytes: [], text: '' },
  ])('encodes $bytes as $text', ({ bytes, text }) => {
    expect(base64Of(new Uint8Array(bytes))).toBe(text);
  });

  it('encodes bytes of any size', () => {
    const bytes = Uint8Array.from({ length: 100_001 }, (_, i) => i % 256);
    const text = base64Of(bytes);
    expect(text).toHaveLength(133_336);
    const decoded = Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
    expect(decoded).toEqual(bytes);
  });
});
