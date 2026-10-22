import type {
  AlignedArea,
  Alignment,
  AreaName,
  ShellLayout,
} from '../../contracts/plugin';
import { ALIGNMENTS } from './shell';

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

// The areas whose contributions sit by alignment, each in a `shell-track`
// container per alignment; the others take contributions straight in.
const ALIGNED_AREAS: ReadonlySet<AreaName> = new Set([
  'titleBar',
  'activityBar',
  'statusBar',
]);

function alignedArea(element: HTMLElement): AlignedArea {
  const tracks = {} as Record<Alignment, HTMLElement>;
  for (const align of ALIGNMENTS) {
    const track = document.createElement('div');
    track.className = `shell-track shell-track-${align}`;
    element.append(track);
    tracks[align] = track;
  }
  return { element, tracks };
}

export const defaultShellLayout: ShellLayout = {
  mount(root) {
    root.classList.add('shell');
    const areas = {} as Record<AreaName, HTMLElement | AlignedArea>;
    for (const name of Object.keys(AREA_CLASSES) as AreaName[]) {
      const element = document.createElement('div');
      element.className = AREA_CLASSES[name];
      root.append(element);
      areas[name] = ALIGNED_AREAS.has(name) ? alignedArea(element) : element;
    }
    return areas;
  },
};
