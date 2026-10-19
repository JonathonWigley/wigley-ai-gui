import type { Area, AreaName } from '../../contracts/plugin';

const AREA_CLASSES: Record<AreaName, string> = {
  activityBar: 'shell-activity-bar',
  sideBar: 'shell-side-bar',
  main: 'shell-main',
  panel: 'shell-panel',
  statusBar: 'shell-status-bar',
  overlay: 'shell-overlay',
};

// An area that shows while it holds at least one contribution.
function createArea(element: HTMLElement): Area {
  element.hidden = true;
  return {
    contribute(contribution) {
      element.append(contribution);
      element.hidden = false;
      return {
        remove() {
          contribution.remove();
          element.hidden = element.childElementCount === 0;
        },
      };
    },
  };
}

// Keeps `--wg-status-bar-height` on the document root equal to the status
// bar's rendered height, `0px` while it is hidden.
function publishStatusBarHeight(statusBar: HTMLElement) {
  const publish = () =>
    document.documentElement.style.setProperty(
      '--wg-status-bar-height',
      `${statusBar.offsetHeight}px`,
    );
  publish();
  new ResizeObserver(publish).observe(statusBar);
}

// Builds the window's six areas inside `root`, each hidden until something is
// contributed to it, and publishes the status bar's height.
export function mountShell(root: HTMLElement): Record<AreaName, Area> {
  root.classList.add('shell');
  const areas = {} as Record<AreaName, Area>;
  for (const name of Object.keys(AREA_CLASSES) as AreaName[]) {
    const element = document.createElement('div');
    element.className = AREA_CLASSES[name];
    root.append(element);
    areas[name] = createArea(element);
    if (name === 'statusBar') {
      publishStatusBarHeight(element);
    }
  }
  return areas;
}
