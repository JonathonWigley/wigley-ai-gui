// The auto-start countdown's text: the whole seconds left until `endsAt`,
// rounded up, as `10s`; `0s` at or past it.
export function countdownText(endsAt: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((endsAt - now) / 1000));
  return `${seconds}s`;
}
