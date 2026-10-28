import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from '../../../shared/page/test-dom';
import { HARNESSES } from '../contract';
import { PREVIEW_STATE, PREVIEW_STATUSES, previewToggle } from './preview';
import {
  drawnRows,
  rowNamed,
  sessionsViewSetup,
  stateOf,
} from './sessions-view-fakes';

beforeEach(() => {
  installFakeDom(vi.stubGlobal);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sessions preview', () => {
  it('preview_SampleRows_CoverEveryRowState', () => {
    const { rows, selectedSessionId } = PREVIEW_STATE;
    const statusOf = (sessionId: string) => PREVIEW_STATUSES[sessionId] ?? null;

    expect(rows.map((row) => row.sessionId)).toContain(selectedSessionId);
    expect(rows.some((row) => row.marked)).toBe(true);
    expect(rows.some((row) => !row.marked)).toBe(true);
    expect(new Set(rows.map((row) => row.harness))).toEqual(
      new Set([...HARNESSES, null]),
    );
    expect(rows.some((row) => statusOf(row.sessionId) !== null)).toBe(true);
    expect(rows.some((row) => statusOf(row.sessionId) === null)).toBe(true);
  });

  it('sessionsView_PreviewShown_SendsNothingAndRestoresRealRows', () => {
    const { view, sideBar, activated } = sessionsViewSetup();
    view.render(stateOf(['real-1', 'real-2'], 'real-1'));

    view.showPreview(true);
    rowNamed(drawnRows(sideBar), 'scratch').click();
    const selected = rowNamed(drawnRows(sideBar), 'scratch');
    view.render(stateOf(['real-3'], 'real-3'));
    const rowsWhileShown = drawnRows(sideBar).map((row) => row.textContent);
    view.showPreview(false);

    expect(activated).toEqual([]);
    expect(selected.classList.contains('is-selected')).toBe(true);
    expect(rowsWhileShown).toHaveLength(PREVIEW_STATE.rows.length);
    const realRows = drawnRows(sideBar);
    expect(realRows).toHaveLength(1);
    expect(realRows[0].textContent).toContain('label real-3');
  });

  it.each([
    { by: 1 as const, selected: 'wigley-ai-marketplace' },
    { by: -1 as const, selected: 'a-session-label-long-enough' },
  ])(
    'sessionsView_StepPreview_MovesSampleSelectionOnly (by $by)',
    ({ by, selected }) => {
      const { view, sideBar, activated } = sessionsViewSetup();
      view.render(stateOf(['real-1', 'real-2'], 'real-1'));
      view.showPreview(true);

      view.stepPreview(by);

      const rows = drawnRows(sideBar);
      const marked = rows.filter((row) =>
        row.classList.contains('is-selected'),
      );
      expect(marked).toEqual([rowNamed(rows, selected)]);
      expect(activated).toEqual([]);
    },
  );

  it.each([
    {
      case: 'side bar closed before',
      isOpenBefore: false,
      closedBetween: false,
      isOpenAfter: false,
    },
    {
      case: 'side bar open before',
      isOpenBefore: true,
      closedBetween: false,
      isOpenAfter: true,
    },
    {
      case: 'side bar closed between presses',
      isOpenBefore: false,
      closedBetween: true,
      isOpenAfter: false,
    },
  ])(
    'previewToggle_SecondPress_LeavesSideBarAsBeforeFirst ($case)',
    ({ isOpenBefore, closedBetween, isOpenAfter }) => {
      let isSideBarShown = isOpenBefore;
      let isPreviewShown = false;
      const mode = {
        show: () => undefined,
        sideBarShown: () => isSideBarShown,
        toggleSideBar: () => {
          isSideBarShown = !isSideBarShown;
        },
      };
      const toggle = previewToggle(
        mode,
        {
          isPreviewShown: () => isPreviewShown,
          showPreview: (isShown) => {
            isPreviewShown = isShown;
          },
        },
        () => undefined,
      );

      toggle();
      const isOpenWhileShown = isSideBarShown;
      if (closedBetween) {
        mode.toggleSideBar();
      }
      toggle();

      expect(isOpenWhileShown).toBe(true);
      expect(isSideBarShown).toBe(isOpenAfter);
      expect(isPreviewShown).toBe(false);
    },
  );
});
