import { describe, expect, it } from 'vitest';
import { CHAT_PREVIEW_HOST_ID } from '../../chat/contract';
import type { SessionFlow } from '../contract';
import { newFlow } from '../flow';
import { PREVIEW_SAMPLES, previewFlow } from './preview';
import { createPreview } from './preview-steps';

const NOW = 1_000_000;

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
    samples: (sessionId, now) =>
      PREVIEW_SAMPLES.map((_, index) => previewFlow(index, sessionId, now, 7)),
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

  it('press_SamplesOfTwoWorkflows_NumbersTheJoinedList', () => {
    const sample = (workflow: string, stage: string): SessionFlow => ({
      ...newFlow(PREVIEW_ROW, '/p'),
      workflow,
      stage,
    });
    const lines: string[] = [];
    const closed: string[] = [];
    const samples = [
      sample('a', 'a1'),
      sample('a', 'a2'),
      sample('b', 'b1'),
      sample('b', 'b2'),
    ];
    const reads: number[] = [];
    const preview = createPreview({
      openChatPreview: () => undefined,
      previewSessionId: () => PREVIEW_ROW,
      showFlow: () => undefined,
      closed: (sessionId) => closed.push(sessionId),
      clock: { now: () => NOW },
      samples: (_sessionId, now) => {
        reads.push(now);
        return samples;
      },
      log: (line) => lines.push(line),
    });

    preview.press();
    preview.press();
    preview.press();
    const third = lines.at(-1);
    preview.press();
    const shownBeforeClose = preview.flowOf(PREVIEW_ROW)?.stage;
    preview.press();

    expect(third).toBe('workflow preview step 3 of 4: b1');
    expect(shownBeforeClose).toBe('b2');
    expect(closed).toEqual([PREVIEW_ROW]);
    expect(preview.flowOf(PREVIEW_ROW)).toBeNull();
    expect(reads).toHaveLength(4);
  });

  it('press_NoSamples_ClosesAndShowsNothing', () => {
    const closed: string[] = [];
    const preview = createPreview({
      openChatPreview: () => undefined,
      previewSessionId: () => PREVIEW_ROW,
      showFlow: () => undefined,
      closed: (sessionId) => closed.push(sessionId),
      clock: { now: () => NOW },
      samples: () => [],
      log: () => undefined,
    });

    preview.press();

    expect(closed).toEqual([PREVIEW_ROW]);
    expect(preview.flowOf(PREVIEW_ROW)).toBeNull();
  });
});
