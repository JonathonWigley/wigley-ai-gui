import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FakeElement,
  findAll,
  installFakeDom,
} from '../../../shared/page/test-dom';
import {
  HARNESSES,
  NEEDS_YOU_ACTIVITY,
  type RowActivity,
  type SessionRow,
  type SessionsState,
} from '../contract';
import { sessionRow } from '../contract.test-support';
import { PREVIEW_STATE, previewRowState, previewToggle } from './preview';
import {
  drawnRows,
  rowNamed,
  sessionsViewSetup,
  stateOf,
} from './sessions-view-fakes';

const WORKING: RowActivity = { word: 'working', tone: 'running', rank: 20 };

// The sample row whose label starts with `label`.
function sampleNamed(label: string): SessionRow {
  const found = PREVIEW_STATE.rows.find((row) => row.label.startsWith(label));
  if (found === undefined) {
    throw new Error(`no sample row ${label}`);
  }
  return found;
}

// One row's text in the `default` row's cell `className`, null when the row
// draws no such cell.
function cellText(row: FakeElement, className: string): string | null {
  return findAll(row, className)[0]?.textContent ?? null;
}

// The class of the activity label one row draws and its text, null for none.
function activityLabel(row: FakeElement): {
  className: string;
  text: string;
} | null {
  for (const className of [
    'ui-tag--attention',
    'ui-tag--error',
    'session-row-activity--running',
    'session-row-activity--success',
  ]) {
    const text = cellText(row, className);
    if (text !== null) {
      return { className, text };
    }
  }
  return null;
}

beforeEach(() => {
  installFakeDom(vi.stubGlobal);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sessions preview', () => {
  it('preview_SampleRows_CoverEveryRowState', () => {
    const { rows, selectedSessionId } = PREVIEW_STATE;

    expect(rows.map((row) => row.sessionId)).toContain(selectedSessionId);
    expect(rows.some((row) => row.marked)).toBe(true);
    expect(rows.some((row) => !row.marked)).toBe(true);
    expect(new Set(rows.map((row) => row.harness))).toEqual(
      new Set([...HARNESSES, null]),
    );
  });

  it('previewRowState_SampleRows_AreNeverOnScreen', () => {
    for (const row of PREVIEW_STATE.rows) {
      const state = previewRowState(row, 40);
      expect(state.onScreen).toBe(false);
      expect(state.partTooltips()).toEqual([]);
    }
  });

  it.each([
    {
      label: 'wigley-ai-marketplace',
      title: 'Marketplace release notes',
      activity: 'working',
    },
    { label: 'scratch', title: 'Scratchpad', activity: 'needs you' },
    {
      label: 'a-session-label-long-enough',
      title: 'Look into why the docs index skips syml…',
      activity: 'done',
    },
    { label: 'new-games-prototypes', title: null, activity: 'error' },
    { label: 'wigley-ai-gui', title: null, activity: null },
  ])(
    'previewRowState_PinnedSample_ShowsItsTitleAndActivity ($label)',
    ({ label, title, activity }) => {
      const state = previewRowState(sampleNamed(label), 40);

      expect(state.title).toBe(title);
      expect(state.activity?.word ?? null).toBe(activity);
    },
  );

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
    expect(realRows[0].title).toContain('label real-3');
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

// One session row `s1` labelled `label s1` with an agent title, or none.
function titledState(agent: string | null, marked = false): SessionsState {
  const row = sessionRow('s1');
  return {
    rows: [{ ...row, marked, titles: { ...row.titles, agent } }],
    selectedSessionId: 's1',
  };
}

describe('session rows', () => {
  it.each<{
    case: string;
    agent: string | null;
    marked: boolean;
    activity: RowActivity | null;
    label: string;
    isInFocusedPane?: boolean;
    expected: { className: string; text: string } | null;
  }>([
    {
      case: 'agent title',
      agent: 'Fix the build',
      marked: false,
      activity: null,
      label: 'Fix the build',
      expected: null,
    },
    {
      case: 'no title',
      agent: null,
      marked: false,
      activity: null,
      label: 'New Chat',
      expected: null,
    },
    {
      case: 'working',
      agent: null,
      marked: false,
      activity: WORKING,
      label: 'New Chat',
      expected: {
        className: 'session-row-activity--running',
        text: 'Working',
      },
    },
    {
      case: 'done',
      agent: null,
      marked: false,
      activity: { word: 'done', tone: 'success', rank: 10 },
      label: 'New Chat',
      expected: { className: 'session-row-activity--success', text: 'Done' },
    },
    {
      case: 'error',
      agent: null,
      marked: false,
      activity: { word: 'error', tone: 'error', rank: 30 },
      label: 'New Chat',
      expected: { className: 'ui-tag--error', text: 'Error' },
    },
    {
      case: 'marked with an activity',
      agent: null,
      marked: true,
      activity: WORKING,
      label: 'New Chat',
      expected: {
        className: 'session-row-activity--running',
        text: 'Working',
      },
    },
    {
      case: 'marked alone',
      agent: null,
      marked: true,
      activity: null,
      label: 'New Chat',
      expected: { className: 'ui-tag--attention', text: 'Needs you' },
    },
    {
      case: "marked alone, in the focused pane before main's reply",
      agent: null,
      marked: true,
      activity: null,
      label: 'New Chat',
      isInFocusedPane: true,
      expected: null,
    },
  ])(
    'sessionsView_Row_DrawsTitleOrNewChatAndActivityLabel ($case)',
    ({ agent, marked, activity, label, isInFocusedPane, expected }) => {
      const { view, sideBar } = sessionsViewSetup();
      view.render(titledState(agent, marked));
      if (isInFocusedPane === true) {
        view.panes.load(view.panes.focusedPaneId(), 's1');
      }

      view.setActivity('s1', 'chat', activity);

      const [row] = drawnRows(sideBar);
      expect(cellText(row, 'ui-row-label')).toBe(label);
      expect(activityLabel(row)).toEqual(expected);
    },
  );

  it('sessionsView_TitleLengthChanged_RedrawsRowsWithTheNewCut', () => {
    let titleMaxLength = 40;
    const { view, sideBar } = sessionsViewSetup(
      undefined,
      undefined,
      () => titleMaxLength,
    );
    const row = sessionRow('s1');
    view.render({
      rows: [
        {
          ...row,
          titles: {
            ...row.titles,
            firstMessage: 'Look into why the index skips symlinked folders',
          },
        },
      ],
      selectedSessionId: 's1',
    });

    titleMaxLength = 12;
    view.redrawRows();

    expect(cellText(drawnRows(sideBar)[0], 'ui-row-label')).toBe(
      'Look into w…',
    );
  });

  const throwsNoRound = (): string | null => {
    throw new Error('no round');
  };

  it.each([
    {
      case: 'with an activity',
      activity: WORKING,
      notesTooltip: (): string | null => null,
      tooltip: 'Fix the build · label s1 · working · Round 2/5 · Primer open',
      logged: [],
    },
    {
      case: 'with no activity',
      activity: null,
      notesTooltip: (): string | null => null,
      tooltip: 'Fix the build · label s1 · Round 2/5 · Primer open',
      logged: [],
    },
    {
      case: 'with a part whose tooltip throws',
      activity: WORKING,
      notesTooltip: throwsNoRound,
      tooltip: 'Fix the build · label s1 · working · Round 2/5 · Primer open',
      logged: ['row part notes.status tooltip failed: no round'],
    },
  ])(
    'sessionsView_RowTooltip_JoinsTitleLabelActivityAndPartTooltips ($case)',
    ({ activity, notesTooltip, tooltip, logged: expectedLogged }) => {
      const { view, sideBar, rowParts, logged } = sessionsViewSetup();
      const tooltipPart = (id: string, text: () => string | null) => ({
        id,
        build: () => ({}),
        tooltip: text,
      });
      rowParts.add(tooltipPart('forms.status', () => 'Round 2/5'));
      rowParts.add(tooltipPart('notes.status', notesTooltip));
      rowParts.add(tooltipPart('primer.status', () => 'Primer open'));
      view.render(titledState('Fix the build'));
      view.setActivity('s1', 'chat', activity);

      expect(drawnRows(sideBar)[0].title).toBe(tooltip);
      // Each draw of the row logs once; the count is draw timing.
      expect(new Set(logged)).toEqual(new Set(expectedLogged));
    },
  );

  it('sessionsView_PartTooltipChanged_RefreshesOnPointerEnter', () => {
    const { view, sideBar, rowParts } = sessionsViewSetup();
    let status = 'Round 1/5';
    rowParts.add({
      id: 'forms.status',
      build: () => ({}),
      tooltip: () => status,
    });
    view.render(titledState('Fix the build'));
    const [row] = drawnRows(sideBar);

    status = 'Round 2/5';
    row.fire('pointerenter');

    expect(row.title).toBe('Fix the build · label s1 · Round 2/5');
  });

  it('sessionsView_SetActivityTopUnchanged_DrawsNothing', () => {
    const { view, sideBar } = sessionsViewSetup();
    view.render(stateOf(['s1'], 's1'));
    view.setActivity('s1', 'forms', NEEDS_YOU_ACTIVITY);
    const [before] = drawnRows(sideBar);

    view.setActivity('s1', 'chat', WORKING);

    expect(drawnRows(sideBar)[0]).toBe(before);
  });

  it('sessionsView_SetActivityBeforeItsRow_ShowsOnceTheRowArrives', () => {
    const { view, sideBar } = sessionsViewSetup();
    view.render(stateOf([], null));

    view.setActivity('s1', 'chat', WORKING);
    view.render(stateOf(['s1'], 's1'));

    expect(activityLabel(drawnRows(sideBar)[0])).toEqual({
      className: 'session-row-activity--running',
      text: 'Working',
    });
  });

  it('sessionsView_RowRemoved_DropsItsActivities', () => {
    const { view, sideBar } = sessionsViewSetup();
    view.render(stateOf(['s1'], 's1'));
    view.setActivity('s1', 'chat', WORKING);

    view.render(stateOf([], null));
    view.render(stateOf(['s1'], 's1'));

    expect(activityLabel(drawnRows(sideBar)[0])).toBeNull();
  });
});
