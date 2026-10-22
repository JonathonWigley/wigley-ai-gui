import type { Log } from '../../contracts/log';
import type { Area, Mode, ModeHandle } from '../../contracts/plugin';
import { button } from '../../shared/page/dom';
import { icon } from '../../shared/page/ui/icon';

// The activity bar: one icon button per mode, in the order the modes were
// added, that shows its mode on a click; `mark` marks the shown mode's item,
// logging only when the marked mode changed.
export function createActivityBar(
  area: Area,
  log: Log,
): { add(mode: Mode, handle: ModeHandle): void; mark(modeId: string): void } {
  const items = new Map<string, { title: string; item: HTMLElement }>();
  let markedId: string | null = null;
  return {
    add(mode, handle) {
      const item = button('activity-item', '', () => handle.show());
      item.append(icon(mode.icon));
      item.title = mode.title;
      item.setAttribute('aria-label', mode.title);
      area.contribute(item);
      items.set(mode.id, { title: mode.title, item });
    },
    mark(modeId) {
      for (const [id, { item }] of items) {
        const isMarked = id === modeId;
        item.classList.toggle('is-shown', isMarked);
        if (isMarked) {
          item.setAttribute('aria-current', 'true');
        } else {
          item.removeAttribute('aria-current');
        }
      }
      if (markedId !== modeId) {
        markedId = modeId;
        const title = items.get(modeId)?.title ?? modeId;
        log('page', `marked ${title} in the activity bar`);
      }
    },
  };
}
