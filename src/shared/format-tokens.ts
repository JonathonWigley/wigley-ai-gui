// `0k`, `842`, `180k`, `1.3M`.
export function formatTokens(tokens: number): string {
  if (tokens === 0) {
    return '0k';
  }
  if (tokens < 1000) {
    return String(tokens);
  }
  const thousands = Math.round(tokens / 1000);
  if (thousands < 1000) {
    return `${thousands}k`;
  }
  return `${Math.round(tokens / 100_000) / 10}M`;
}
