const LOW_SURROGATE_FIRST = 0xdc00;
const LOW_SURROGATE_LAST = 0xdfff;

// The last `limit` UTF-16 code units of `text`, less a leading low surrogate, so no character is cut in half.
export function keepTail(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  const tail = text.slice(text.length - limit);
  const first = tail.charCodeAt(0);
  const startsInsidePair =
    first >= LOW_SURROGATE_FIRST && first <= LOW_SURROGATE_LAST;
  return startsInsidePair ? tail.slice(1) : tail;
}
