import type { ModeHandle } from '../../../contracts/plugin';
import {
  NEEDS_YOU_ACTIVITY,
  type RowActivity,
  type SessionRow,
  type SessionsState,
  type SessionTitles,
} from '../contract';
import { shownTitle } from '../session-title';
import { type SidebarSections, sidebarSections } from './sidebar-order';
import type { RowState } from './sidebar-view';

const NO_TITLES: SessionTitles = {
  user: null,
  agent: null,
  firstMessage: null,
};

// Each sample row's titles; a row left out has none.
export const PREVIEW_TITLES: Readonly<Record<string, SessionTitles>> = {
  'preview-2': { ...NO_TITLES, agent: 'Marketplace release notes' },
  'preview-4': { ...NO_TITLES, user: 'Scratchpad' },
  'preview-5': {
    ...NO_TITLES,
    firstMessage:
      'Look into why the docs index skips symlinked folders on Windows',
  },
};

// Each sample row's activity, null for none.
export const PREVIEW_ACTIVITIES: Readonly<Record<string, RowActivity | null>> =
  {
    'preview-1': null,
    'preview-2': { word: 'working', tone: 'running', rank: 20 },
    'preview-3': { word: 'error', tone: 'error', rank: 30 },
    'preview-4': NEEDS_YOU_ACTIVITY,
    'preview-5': { word: 'done', tone: 'success', rank: 10 },
  };

function sampleRow(
  sessionId: string,
  label: string,
  project: string,
  harness: SessionRow['harness'],
  marked: boolean,
): SessionRow {
  return {
    sessionId,
    label,
    project,
    harness,
    marked,
    markToast: null,
    projectDir: null,
    hostSessionId: null,
    titles: PREVIEW_TITLES[sessionId] ?? NO_TITLES,
  };
}

// The side bar rows `Space z l s` shows in place of the real ones, with no
// agent: a selected row, marked and unmarked rows, each harness and none, a
// label long enough to end in an ellipsis, user, agent and first-message
// titles and rows with none, an activity of each tone the rows use, and three
// projects, two of them holding two rows from different folders.
export const PREVIEW_STATE: SessionsState = {
  rows: [
    sampleRow('preview-1', 'wigley-ai-gui', 'wigley-ai-gui', 'claude', false),
    sampleRow(
      'preview-2',
      'wigley-ai-marketplace',
      'wigley-ai-gui',
      'codex',
      true,
    ),
    sampleRow(
      'preview-3',
      'new-games-prototypes',
      'new-games-prototypes',
      'claude',
      true,
    ),
    sampleRow('preview-4', 'scratch', 'wigley-agents', null, false),
    sampleRow(
      'preview-5',
      'a-session-label-long-enough-to-end-in-an-ellipsis-in-the-side-bar',
      'wigley-agents',
      'claude',
      false,
    ),
  ],
  selectedSessionId: 'preview-1',
};

// The sample's own favorites, never the user's.
const PREVIEW_FAVORITES: readonly string[] = ['wigley-ai-gui'];

// The sample rows in the order the side bar draws them.
export function previewSections(
  preview: SessionsState,
): SidebarSections<SessionRow> {
  return sidebarSections(preview.rows, PREVIEW_FAVORITES, new Map(), new Map());
}

// Each sample row's state at the title length `titleMax`: its shown title and
// its activity, no part tooltips, and never on screen, since no pane shows a
// sample session.
export function previewRowState(row: SessionRow, titleMax: number): RowState {
  return {
    title: shownTitle(row.titles, titleMax),
    activity: PREVIEW_ACTIVITIES[row.sessionId] ?? null,
    partTooltips: () => [],
    onScreen: false,
  };
}

// The view the preview toggle swaps the side bar's rows in.
export interface PreviewView {
  isPreviewShown(): boolean;
  showPreview(isShown: boolean): void;
}

// `Space z l s`: shows the sample rows, opening the mode and its side bar, or
// puts the real rows back, closing the side bar again when the press that
// showed them opened it.
export function previewToggle(
  mode: Pick<ModeHandle, 'show' | 'sideBarShown' | 'toggleSideBar'>,
  view: PreviewView,
  log: (message: string) => void,
): () => void {
  let hasOpenedSideBar = false;
  return () => {
    if (view.isPreviewShown()) {
      view.showPreview(false);
      if (hasOpenedSideBar && mode.sideBarShown()) {
        mode.toggleSideBar();
      }
      hasOpenedSideBar = false;
      log('preview closed');
      return;
    }
    mode.show();
    hasOpenedSideBar = !mode.sideBarShown();
    if (hasOpenedSideBar) {
      mode.toggleSideBar();
    }
    view.showPreview(true);
    log('preview shown');
  };
}
