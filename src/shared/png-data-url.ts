const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';

// `bytes` as a PNG data URL.
export function pngDataUrl(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return PNG_DATA_URL_PREFIX + btoa(binary);
}

// The bytes of a base64 `data:` URL: the base64 after its first comma.
export function dataUrlBytes(url: string): Uint8Array {
  const binary = atob(url.slice(url.indexOf(',') + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
