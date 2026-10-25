import type { AppInstance } from '../../contracts/app-instance';
import type { Area, ModeContext } from '../../contracts/plugin';
import { element } from '../../shared/page/dom';
import { tag } from '../../shared/page/ui/tag';

// The title bar's centre: the shown mode's context, its title then its detail,
// hidden while the mode has none. The full detail, or the title without one,
// is the tooltip, since a long one is cut short.
export function mountTitleBarContext(area: Area): {
  show(context: ModeContext | null): void;
} {
  const root = element('span', 'title-bar-context');
  const title = element('span', 'title-bar-context-title');
  const detail = element('span', 'title-bar-context-detail');
  root.append(title, detail);
  root.hidden = true;
  area.contribute(root, { align: 'center' });
  return {
    show(context) {
      root.hidden = context === null;
      if (context === null) {
        return;
      }
      title.textContent = context.title;
      detail.textContent = context.detail ?? '';
      detail.hidden = context.detail === null;
      root.title = context.detail ?? context.title;
    },
  };
}

// A Dev tag at the title bar's start in the dev app, so it reads apart from
// the stable app; nothing in the stable app.
export function mountDevTag(area: Area, instance: AppInstance): void {
  if (!instance.isDev) {
    return;
  }
  area.contribute(tag('Dev', 'neutral'), { align: 'start' });
}
