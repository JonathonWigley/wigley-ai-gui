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

// Builds the window's six areas inside `root`, each hidden until something is
// contributed to it.
export function mountShell(root: HTMLElement): Record<AreaName, Area> {
  root.classList.add('shell');
  const areas = {} as Record<AreaName, Area>;
  for (const name of Object.keys(AREA_CLASSES) as AreaName[]) {
    const element = document.createElement('div');
    element.className = AREA_CLASSES[name];
    root.append(element);
    areas[name] = createArea(element);
  }
  return areas;
}
