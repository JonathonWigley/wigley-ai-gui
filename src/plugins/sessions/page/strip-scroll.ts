// A tab strip's scroll and the box of the tab it shows: the parts of their
// elements the scroll reads.
export type ScrolledStrip = Pick<
  HTMLElement,
  'getBoundingClientRect' | 'scrollLeft' | 'clientWidth'
>;
export type StripTab = Pick<HTMLElement, 'getBoundingClientRect'>;

// The strip's scroll that shows all of `tab`, moving the least: the current
// one when the tab is in view already. Measured from the strip, so a
// positioned wrapper a layout draws around it does not change it.
export function scrollLeftShowing(strip: ScrolledStrip, tab: StripTab): number {
  const tabBox = tab.getBoundingClientRect();
  const start =
    tabBox.left - strip.getBoundingClientRect().left + strip.scrollLeft;
  const end = start + tabBox.width;
  if (start < strip.scrollLeft) {
    return start;
  }
  if (end > strip.scrollLeft + strip.clientWidth) {
    return end - strip.clientWidth;
  }
  return strip.scrollLeft;
}
