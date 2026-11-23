// `bytes` from its first byte that is not a UTF-8 continuation byte
// (`10xxxxxx`), so a character a cut split at the start is left out.
export function withoutLeadingContinuationBytes(bytes: Uint8Array): Uint8Array {
  let first = 0;
  while (first < bytes.length && (bytes[first] & 0xc0) === 0x80) {
    first += 1;
  }
  return bytes.subarray(first);
}
