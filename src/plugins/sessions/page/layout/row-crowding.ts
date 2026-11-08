import type { PartRollback } from '../../../../shared/page/contributed-parts';

// The class a row's parts holder carries while its parts, laid on one line,
// need more than its width.
const CROWDED_CLASS = 'is-crowded';

// Keeps `CROWDED_CLASS` on `holder` while its parts overflow it on one line,
// measured with the class off, so a layout can move some of them to a line of
// their own. It measures a frame after the holder or a part changes size, as
// when a side bar drag or a part's new content does, and stops with the row's
// draw.
export function markCrowding(
  holder: HTMLElement,
  rollback: PartRollback,
): void {
  let frame: number | null = null;
  const measure = () => {
    frame = null;
    holder.classList.remove(CROWDED_CLASS);
    const overflows = holder.scrollWidth > holder.clientWidth;
    holder.classList.toggle(CROWDED_CLASS, overflows);
  };
  // A resize inside the callback raises ResizeObserver's loop error.
  const observer = new ResizeObserver(() => {
    frame ??= requestAnimationFrame(measure);
  });
  observer.observe(holder);
  for (const wrapper of holder.children) {
    observer.observe(wrapper);
  }
  rollback.recordBox(() => {
    observer.disconnect();
    if (frame !== null) {
      cancelAnimationFrame(frame);
    }
  });
}
