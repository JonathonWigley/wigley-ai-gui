// The height of one line of the body text `scroller` shows, in pixels: its
// first markdown block's line, else its own.
export function textLineHeightPx(scroller: Element): number {
  const text = scroller.querySelector('.md') ?? scroller;
  const style = getComputedStyle(text);
  if (style.lineHeight !== 'normal') {
    return parseFloat(style.lineHeight);
  }
  const leading = parseFloat(style.getPropertyValue('--wg-leading-prose'));
  if (Number.isNaN(leading)) {
    throw new Error(
      'textLineHeightPx: line-height is normal and --wg-leading-prose is unset',
    );
  }
  return parseFloat(style.fontSize) * leading;
}
