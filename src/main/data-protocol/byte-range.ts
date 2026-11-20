// The bytes a `Range` request header asks of a file `size` bytes long, both
// ends inclusive, as a video element asks to seek: `bytes=<start>-<end>`,
// `bytes=<start>-` (to the end) or `bytes=-<count>` (the last `count`), an end
// past the file's clamped to its last byte. Null for a header the route
// answers with the whole file: none, a unit other than bytes, a list of ranges
// or one it cannot parse. `unsatisfiable` for a range that starts past the end
// or holds no bytes, which answers 416.
export function byteRangeOf(
  header: string | null,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | null {
  const match =
    header === null ? null : /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null || (match[1] === '' && match[2] === '')) {
    return null;
  }
  const [, first, last] = match;
  if (first === '') {
    const count = Number(last);
    return count === 0 || size === 0
      ? 'unsatisfiable'
      : { start: Math.max(0, size - count), end: size - 1 };
  }
  const start = Number(first);
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  return start >= size || end < start ? 'unsatisfiable' : { start, end };
}
