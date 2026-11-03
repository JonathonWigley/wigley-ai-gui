// Runs `redraw`, then sets back the scroll of each of `scrollers` and the
// focus and selection of the element inside `root` that held focus before,
// which the redraw may have detached and placed again.
export function keepingFocusAndScroll(
  root: HTMLElement,
  scrollers: readonly HTMLElement[],
  redraw: () => void,
): void {
  const tops = scrollers.map((scroller) => scroller.scrollTop);
  const active = document.activeElement;
  const focused =
    active instanceof HTMLElement && root.contains(active) ? active : null;
  const range = selectionOf(focused);
  redraw();
  scrollers.forEach((scroller, index) => {
    scroller.scrollTop = tops[index];
  });
  const isFocusLost =
    focused !== null &&
    focused !== document.activeElement &&
    root.contains(focused);
  if (isFocusLost) {
    focused.focus({ preventScroll: true });
    if (range !== null) {
      (focused as HTMLInputElement).setSelectionRange(range.start, range.end);
    }
  }
}

// A text input's selection; null for any other element.
function selectionOf(
  focused: HTMLElement | null,
): { start: number; end: number } | null {
  const input = focused as Partial<HTMLInputElement> | null;
  if (input?.selectionStart == null || input.selectionEnd == null) {
    return null;
  }
  return { start: input.selectionStart, end: input.selectionEnd };
}
