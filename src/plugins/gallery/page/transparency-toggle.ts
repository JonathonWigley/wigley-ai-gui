// The override the gallery's switch sets next, read from the override in
// force rather than the OS: `reduced` from none or `full`, `full` from
// `reduced`.
export function nextTransparency(
  overridden: 'full' | 'reduced' | null,
): 'full' | 'reduced' {
  return overridden === 'reduced' ? 'full' : 'reduced';
}
