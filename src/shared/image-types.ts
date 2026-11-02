// The image types a message can carry.
export const IMAGE_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
];

// The API's per-image cap, measured on the base64 text it receives.
export const MAX_IMAGE_BASE64 = 5 * 1024 * 1024;

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'application/pdf': 'pdf',
  'video/mp4': 'mp4',
};

// The extension a file of `mediaType` is saved under: a known type's own, else
// its short plain subtype ('image/svg+xml' → 'svg'), else 'bin'.
export function extensionOf(mediaType: string): string {
  const type = mediaType.split(';')[0].trim().toLowerCase();
  const known = EXTENSIONS[type] as string | undefined;
  if (known !== undefined) {
    return known;
  }
  const slash = type.indexOf('/');
  const subtype = slash === -1 ? '' : type.slice(slash + 1).split('+')[0];
  return /^[a-z0-9]{1,8}$/.test(subtype) ? subtype : 'bin';
}

// The base64 text length of `byteCount` bytes.
export function base64LengthOf(byteCount: number): number {
  return 4 * Math.ceil(byteCount / 3);
}

// Bytes per `String.fromCharCode` call: one spread of a whole image overflows
// the stack.
const BASE64_SLICE = 0x8000;

export function base64Of(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let start = 0; start < bytes.length; start += BASE64_SLICE) {
    chunks.push(
      String.fromCharCode(...bytes.subarray(start, start + BASE64_SLICE)),
    );
  }
  return btoa(chunks.join(''));
}
