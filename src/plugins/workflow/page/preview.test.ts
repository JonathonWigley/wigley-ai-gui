import { describe, expect, it } from 'vitest';
import { CHAT_PREVIEW_HOST_ID } from '../../chat/contract';
import type { SessionFlow } from '../contract';
import { heavyStateOf } from '../stages/heavy-contract';
import { PREVIEW_SAMPLES, createPreview, previewFlow } from './preview';

const NOW = 1_000_000;

describe('previewFlow', () => {
  it.each([
    { index: 0, stage: 'idle', busy: false, endsAt: null, checked: null },
    { index: 1, stage: 'primer', busy: true, endsAt: null, checked: null },
    { index: 2, stage: 'explore', busy: false, endsAt: null, checked: null },
    { index: 3, stage: 'interview', busy: true, endsAt: null, checked: null },
    { index: 4, stage: 'plan', busy: false, endsAt: null, checked: 0 },
    { index: 5, stage: 'coldRead', busy: true, endsAt: null, checked: 0 },
    { index: 6, stage: 'planReady', busy: false, endsAt: null, checked: 0 },
    {
      index: 7,
      stage: 'planReady',
      busy: false,
      endsAt: NOW + 7000,
      checked: 0,
    },
    { index: 8, stage: 'make', busy: true, endsAt: null, checked: 3 },
    { index: 9, stage: 'make', busy: false, endsAt: null, checked: 3 },
    { index: 10, stage: 'review', busy: true, endsAt: null, checked: 6 },
    { index: 11, stage: 'fix', busy: true, endsAt: null, checked: 6 },
    { index: 12, stage: 'closed', busy: false, endsAt: null, checked: 7 },
  ])(
    'previewFlow_EachIndex_ShowsItsSample $index',
    ({ index, stage, busy, endsAt, checked }) => {
      const flow = previewFlow(index, 'preview', NOW, 7);

      const heavy = heavyStateOf(flow);
      expect({
        stage: flow.stage,
        busy: flow.turnRunning,
        endsAt: heavy.countdownEndsAt,
        checked: heavy.progress?.checked ?? null,
      }).toEqual({ stage, busy, endsAt, checked });
    },
  );
});

const PREVIEW_ROW = 'row-preview';

// A preview whose `showFlow` and `closed` record each flow and session, and a
// chat whose preview row is heard of on the `rowAdded` step only, as when
// chat's open lands after the press or fails.
function setUpPreview() {
  let rowHeard = false;
  let opens = 0;
  const shownFlows: SessionFlow[] = [];
  const closed: string[] = [];
  const lines: string[] = [];
  const preview = createPreview({
    openChatPreview: () => {
      opens += 1;
    },
    previewSessionId: () => (rowHeard ? PREVIEW_ROW : null),
    showFlow: (flow) => shownFlows.push(flow),
    closed: (sessionId) => closed.push(sessionId),
    clock: { now: () => NOW },
    autoStartSeconds: () => 7,
    log: (line) => lines.push(line),
  });
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
    shownStages: shownFlows.map((flow) => flow.stage),
    closed,
    shown: preview.flowOf(PREVIEW_ROW)?.stage ?? null,
    lines,
  });
  return { steps, result };
}

type PreviewStep = 'press' | 'rowAdded' | 'otherRowAdded' | 'rowRemoved';

const STAGES = PREVIEW_SAMPLES.map((sample) => sample.stage);
const STEP_LINES = STAGES.map(
  (stage, index) =>
    `workflow preview step ${index + 1} of ${STAGES.length}: ${stage}`,
);
const EVERY_PRESS: PreviewStep[] = STAGES.map(() => 'press');

describe('createPreview', () => {
  it.each<{
    case: string;
    order: PreviewStep[];
    expected: {
      opens: number;
      shownStages: string[];
      closed: string[];
      shown: string | null;
      lines: string[];
    };
  }>([
    {
      case: 'RowHeard_StepsThroughEverySampleThenClosesThenReopens',
      order: ['rowAdded', ...EVERY_PRESS, 'press', 'press'],
      expected: {
        opens: 2,
        shownStages: [...STAGES, 'idle'],
        closed: [PREVIEW_ROW],
        shown: 'idle',
        lines: [...STEP_LINES, 'workflow preview closed', STEP_LINES[0]],
      },
    },
    {
      case: 'RowAddedAfterThePress_ShowsTheFirstSample',
      order: ['press', 'otherRowAdded', 'rowAdded'],
      expected: {
        opens: 1,
        shownStages: ['idle'],
        closed: [],
        shown: 'idle',
        lines: [STEP_LINES[0]],
      },
    },
    {
      case: 'PressWhileNoRowArrives_AsksChatAgain',
      order: ['press', 'press', 'rowAdded'],
      expected: {
        opens: 2,
        shownStages: ['idle'],
        closed: [],
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
        shownStages: ['idle', 'primer', 'idle'],
        closed: [],
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
