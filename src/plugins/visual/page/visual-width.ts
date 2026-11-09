// A visual's width: the reading width its markdown keeps, or wide, its
// column's whole width. A wide visual's `div.visual-host` carries `is-wide`,
// and `visual.css` lifts the reading width off the block holding it.
const WIDE_CLASS = 'is-wide';

// `<meta name="visual-width" content="wide">`, its attributes in either
// order and quoted or not: the agent's mark for a visual that needs room.
const WIDE_MARK =
  /<meta\b(?=[^>]*\bname\s*=\s*["']?visual-width\b)(?=[^>]*\bcontent\s*=\s*["']?wide\b)[^>]*>/i;

// Whether `source` carries the agent's wide mark.
export function marksWide(source: string): boolean {
  return WIDE_MARK.test(source);
}

// Sets `host` wide or back to the reading width.
export function setWide(host: HTMLElement, isWide: boolean): void {
  host.classList.toggle(WIDE_CLASS, isWide);
}

// Flips `host` between the reading width and wide, and logs
// `visual width: wide` or `visual width: reading`.
export function toggleWidth(
  host: HTMLElement,
  log: (message: string) => void,
): void {
  const isWide = !host.classList.contains(WIDE_CLASS);
  setWide(host, isWide);
  log(`visual width: ${isWide ? 'wide' : 'reading'}`);
}
