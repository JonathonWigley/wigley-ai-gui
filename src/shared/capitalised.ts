// `text` with its first letter in capitals; the rest is left as written, and
// an empty string stays empty.
export function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
