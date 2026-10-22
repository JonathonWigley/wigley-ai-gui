import type { AreaName, ShellLayout } from '../../contracts/plugin';

// The window width below which a mode's side bar lies over the content
// instead of beside it.
export const SIDE_BAR_OVER_QUERY = '(max-width: 679px)';

// The default layout: `shell.css` places each area by its class, the title bar
// across the top, the activity bar and side bar down the left, main with the
// panel under it, and the status bar across the bottom.
const AREA_CLASSES: Record<AreaName, string> = {
  titleBar: 'shell-title-bar',
  activityBar: 'shell-activity-bar',
  sideBar: 'shell-side-bar',
  main: 'shell-main',
  panel: 'shell-panel',
  statusBar: 'shell-status-bar',
  overlay: 'shell-overlay',
};

export const defaultShellLayout: ShellLayout = {
  mount(root) {
    root.classList.add('shell');
    const elements = {} as Record<AreaName, HTMLElement>;
    for (const name of Object.keys(AREA_CLASSES) as AreaName[]) {
      const element = document.createElement('div');
      element.className = AREA_CLASSES[name];
      root.append(element);
      elements[name] = element;
    }
    return elements;
  },
};
