// Whether the trimmed `query` sits in `text`, ignoring case.
export function matchesSubstring(query: string, text: string): boolean {
  return text.toLowerCase().includes(query.trim().toLowerCase());
}
