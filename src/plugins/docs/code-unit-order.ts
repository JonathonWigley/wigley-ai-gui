// Orders two strings by code unit, the same on every machine and locale.
export function codeUnitOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
