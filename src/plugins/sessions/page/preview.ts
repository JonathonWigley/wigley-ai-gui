import type { ModeHandle } from '../../../contracts/plugin';
import type { SessionRow, SessionsState } from '../contract';

function sampleRow(
  sessionId: string,
  label: string,
  harness: SessionRow['harness'],
  marked: boolean,
): SessionRow {
  return {
    sessionId,
    label,
    harness,
    marked,
    projectDir: null,
    hostSessionId: null,
  };
}

// The side bar rows `Space z l s` shows in place of the real ones, with no
// agent: a selected row, marked and unmarked rows, each harness and none, and
// a label long enough to end in an ellipsis.
export const PREVIEW_STATE: SessionsState = {
  rows: [
    sampleRow('preview-1', 'wigley-ai-gui', 'claude', false),
    sampleRow('preview-2', 'wigley-ai-marketplace', 'codex', true),
    sampleRow('preview-3', 'new-games-prototypes', 'claude', true),
    sampleRow('preview-4', 'scratch', null, false),
    sampleRow(
      'preview-5',
      'a-session-label-long-enough-to-end-in-an-ellipsis-in-the-side-bar',
      'claude',
      false,
    ),
  ],
  selectedSessionId: 'preview-1',
};

// Each sample row's second line, null for none.
export const PREVIEW_STATUSES: Readonly<Record<string, string | null>> = {
  'preview-1': 'working',
  'preview-2': 'waiting for permission',
  'preview-3': null,
  'preview-4': null,
  'preview-5': null,
};

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
