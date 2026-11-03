import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from '../../../shared/page/test-dom';
import { CHAT_PREVIEW_HOST_ID } from '../../chat/contract';
import { newFlow } from '../flow';
import { createFlowTabs } from './flow-tab';
import { PREVIEW_STAGES, createPreview, previewFlow } from './preview';

const NOW = 1_000_000;

beforeEach(() => {
  installFakeDom(vi.stubGlobal);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('previewFlow', () => {
  it.each([
    { index: 0, stage: 'idle', endsAt: null, checked: null },
    { index: 1, stage: 'primer', endsAt: null, checked: null },
    { index: 2, stage: 'feature', endsAt: null, checked: 0 },
    { index: 3, stage: 'planReady', endsAt: null, checked: 0 },
    { index: 4, stage: 'planReady', endsAt: NOW + 7000, checked: 0 },
    { index: 5, stage: 'make', endsAt: null, checked: 3 },
    { index: 6, stage: 'review', endsAt: null, checked: 6 },
    { index: 7, stage: 'closed', endsAt: null, checked: 7 },
  ])(
    'previewFlow_EachIndex_ShowsItsStage $index',
    ({ index, stage, endsAt, checked }) => {
      const flow = previewFlow(index, 'preview', NOW, 7);

      expect({
        stage: flow.stage,
        endsAt: flow.countdownEndsAt,
        checked: flow.progress?.checked ?? null,
        hasLeftIdle: flow.hasLeftIdle,
      }).toEqual({ stage, endsAt, checked, hasLeftIdle: true });
    },
  );
});

const PREVIEW_ROW = 'row-preview';

// A preview over a real Flow tabs whose strip is built, sessions that record
// each added Flow tab, and a chat whose preview row is heard of on the
// `rowAdded` step only, as when chat's open lands after the press or fails.
function setUpPreview() {
  let rowHeard = false;
  let opens = 0;
  let tabAdds = 0;
  const lines: string[] = [];
  const flowTabs = createFlowTabs({
    addTab() {
      tabAdds += 1;
      return {
        setStatus: () => undefined,
        select: () => undefined,
        takeOver: () => ({ release: () => undefined }),
        dispose: () => undefined,
        isVisible: () => false,
      };
    },
    timers: { set: () => 0, clear: () => undefined },
    log: () => undefined,
    flowOf: (sessionId) =>
      preview.flowOf(sessionId) ?? newFlow(sessionId, '/p/proj'),
    nameOf: () => 'preview',
    draw: () => ({ dispose: () => undefined }),
    shown: () => undefined,
  });
  const preview = createPreview({
    openChatPreview: () => {
      opens += 1;
    },
    previewSessionId: () => (rowHeard ? PREVIEW_ROW : null),
    showFlow: (flow) => flowTabs.setFlow(flow),
    closed: (sessionId) => flowTabs.removeTab(sessionId),
    clock: { now: () => NOW },
    autoStartSeconds: () => 7,
    log: (_source, line) => lines.push(line),
  });
  flowTabs.chatTabBuilt(PREVIEW_ROW);
  const steps = {
    press: () => preview.press(),
    rowAdded() {
      rowHeard = true;
      preview.sessionAdded(PREVIEW_ROW, CHAT_PREVIEW_HOST_ID);
    },
    otherRowAdded: () => preview.sessionAdded('row-other', 'host-other'),
    rowRemoved() {
      rowHeard = false;
      preview.sessionRemoved(PREVIEW_ROW);
    },
  };
  const result = () => ({
    opens,
    tabAdds,
    shown: preview.flowOf(PREVIEW_ROW)?.stage ?? null,
    lines,
  });
  return { steps, result };
}

type PreviewStep = 'press' | 'rowAdded' | 'otherRowAdded' | 'rowRemoved';

const STEP_LINES = PREVIEW_STAGES.map(
  (stage, index) =>
    `workflow preview step ${index + 1} of ${PREVIEW_STAGES.length}: ${stage}`,
);
const EVERY_PRESS: PreviewStep[] = PREVIEW_STAGES.map(() => 'press');

describe('createPreview', () => {
  it.each<{
    case: string;
    order: PreviewStep[];
    expected: {
      opens: number;
      tabAdds: number;
      shown: string | null;
      lines: string[];
    };
  }>([
    {
      case: 'RowHeard_StepsThroughEverySampleThenClosesThenReopens',
      order: ['rowAdded', ...EVERY_PRESS, 'press', 'press'],
      expected: {
        opens: 2,
        tabAdds: 2,
        shown: 'idle',
        lines: [...STEP_LINES, 'workflow preview closed', STEP_LINES[0]],
      },
    },
    {
      case: 'RowAddedAfterThePress_ShowsTheFirstSample',
      order: ['press', 'otherRowAdded', 'rowAdded'],
      expected: { opens: 1, tabAdds: 1, shown: 'idle', lines: [STEP_LINES[0]] },
    },
    {
      case: 'PressWhileNoRowArrives_AsksChatAgain',
      order: ['press', 'press', 'rowAdded'],
      expected: {
        opens: 2,
        tabAdds: 1,
        shown: 'idle',
        lines: [
          'workflow preview still waits on the chat preview: asked again',
          STEP_LINES[0],
        ],
      },
    },
    {
      case: 'RowRemoved_NextPressOpensFromTheFirstSample',
      order: ['rowAdded', 'press', 'press', 'rowRemoved', 'press', 'rowAdded'],
      expected: {
        opens: 2,
        tabAdds: 1,
        shown: 'idle',
        lines: [STEP_LINES[0], STEP_LINES[1], STEP_LINES[0]],
      },
    },
  ])('press_$case', ({ order, expected }) => {
    const { steps, result } = setUpPreview();

    for (const step of order) {
      steps[step]();
    }

    expect(result()).toEqual(expected);
  });
});
