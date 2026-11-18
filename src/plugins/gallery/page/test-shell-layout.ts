import './gallery.css';
import type {
  AlignedArea,
  AreaName,
  ShellLayout,
} from '../../../contracts/plugin';
import { element } from '../../../shared/page/dom';

// An area split into its three alignment tracks, each a `gallery-test-track`.
function alignedArea(className: string): AlignedArea {
  const area = element('div', className);
  const tracks = {
    start: element('div', 'gallery-test-track gallery-test-track-start'),
    center: element('div', 'gallery-test-track gallery-test-track-center'),
    end: element('div', 'gallery-test-track gallery-test-track-end'),
  };
  area.append(tracks.start, tracks.center, tracks.end);
  return { element: area, tracks };
}

// A shell layout the default never makes, so a contribution the swap fails to
// move shows out of place: the status bar under the title bar, above the main
// area, and the activity bar on the end side, past the right bar.
// `gallery.css` places each area by its class.
export const testShellLayout: ShellLayout = {
  mount(root) {
    root.classList.add('gallery-test-shell');
    const areas: Record<AreaName, HTMLElement | AlignedArea> = {
      titleBar: alignedArea('gallery-test-title-bar material-chrome'),
      statusBar: alignedArea('gallery-test-status-bar material-chrome'),
      leftBar: element(
        'div',
        'gallery-test-left-bar material-chrome material-chrome--dense',
      ),
      sideBar: element(
        'div',
        'gallery-test-side-bar material-chrome material-chrome--dense',
      ),
      main: element('div', 'gallery-test-main'),
      rightBar: element(
        'div',
        'gallery-test-right-bar material-chrome material-chrome--dense',
      ),
      panel: element('div', 'gallery-test-panel'),
      activityBar: alignedArea('gallery-test-activity-bar material-chrome'),
      overlay: element('div', 'gallery-test-overlay'),
    };
    for (const area of Object.values(areas)) {
      root.append(area instanceof HTMLElement ? area : area.element);
    }
    return areas;
  },
};
