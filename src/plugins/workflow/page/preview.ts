// The layout preview's sample flows (`Space z l w`): one per press, through
// every built-in stage, the plan-ready countdown on the second plan ready.
// The stage ids are sample data, not stage rules.
import type { Clock } from '../../../contracts/ambient';
import type { Log } from '../../../contracts/log';
import { CHAT_PREVIEW_HOST_ID } from '../../chat/contract';
import type { StageId, SessionFlow } from '../contract';
import type { PlanProgress, PlanTaskLine } from '../plan-reader';

export const PREVIEW_STAGES: readonly StageId[] = [
  'idle',
  'primer',
  'feature',
  'planReady',
  'planReady',
  'make',
  'review',
  'closed',
];

const COUNTDOWN_INDEX = 4;
const PREVIEW_PROJECT = 'Workflow preview';
const PREVIEW_PLAN_DIR = '~/docs/features/preview/plan-preview';
const PREVIEW_TITLE = 'Preview plan';

// The sample plan's seven tasks, by the wave each sits under.
const PREVIEW_TASKS: readonly Omit<PlanTaskLine, 'done'>[] = [
  { wave: 1, text: 'Write the contract' },
  { wave: 1, text: 'Read the plan file' },
  { wave: 1, text: 'Fold the signals' },
  { wave: 2, text: 'Draw the row chip' },
  { wave: 2, text: 'Draw the composer strip' },
  { wave: 2, text: 'Add the Flow tab' },
  { wave: 3, text: 'Run the self-test' },
];

// How far the sample plan has come at each stage that has one.
const PREVIEW_PROGRESS: Readonly<
  Record<StageId, { checked: number; reviewRounds: number }>
> = {
  feature: { checked: 0, reviewRounds: 0 },
  planReady: { checked: 0, reviewRounds: 0 },
  make: { checked: 3, reviewRounds: 0 },
  review: { checked: 6, reviewRounds: 1 },
  closed: { checked: 7, reviewRounds: 1 },
};

// The sample flow `index` of PREVIEW_STAGES shows, over the preview session.
// It has left idle in every sample, idle included, so the Flow tab shows from
// the first press.
export function previewFlow(
  index: number,
  sessionId: string,
  now: number,
  autoStartSeconds: number,
): SessionFlow {
  const stage = PREVIEW_STAGES[index];
  const progress = previewProgress(stage);
  return {
    sessionId,
    projectDir: PREVIEW_PROJECT,
    stage,
    planDir: progress === null ? null : PREVIEW_PLAN_DIR,
    progress,
    turnRunning: false,
    runningSubagents: [],
    countdownEndsAt:
      index === COUNTDOWN_INDEX ? now + autoStartSeconds * 1000 : null,
    hasLeftIdle: true,
  };
}

function previewProgress(stage: StageId): PlanProgress | null {
  const reached = PREVIEW_PROGRESS[stage];
  if (reached === undefined) {
    return null;
  }
  const tasks = PREVIEW_TASKS.map((task, index) => ({
    ...task,
    done: index < reached.checked,
  }));
  return {
    checked: reached.checked,
    total: tasks.length,
    wave: tasks.find((task) => !task.done)?.wave ?? null,
    reviewRounds: reached.reviewRounds,
    title: PREVIEW_TITLE,
    tasks,
  };
}

// `openChatPreview` runs chat's preview command, which opens chat's preview
// session or selects its row, and reports a failure itself.
// `previewSessionId` is that session's row, null while none is heard of.
// `showFlow` draws a flow in the view and the Flow tabs; `closed` removes the
// preview session's Flow tab and draws the session's own flow again.
// `autoStartSeconds` is the countdown setting the plan-ready sample runs.
export interface PreviewDeps {
  openChatPreview(): void;
  previewSessionId(): string | null;
  showFlow(flow: SessionFlow): void;
  closed(sessionId: string): void;
  clock: Clock;
  autoStartSeconds(): number;
  log: Log;
}

// `press` is the preview key: the first press opens chat's preview session
// and shows the first sample in it, each next press the next sample, and the
// press after the last closes the preview. A press while chat's preview row
// is not yet heard of asks chat again, so a preview that failed to open
// opens on the next press. `sessionAdded` shows the first sample in chat's
// preview row when it arrives after a press. `flowOf` is the sample the
// session shows, null for a session outside the preview.
export interface Preview {
  press(): void;
  sessionAdded(sessionId: string, hostSessionId: string | null): void;
  sessionRemoved(sessionId: string): void;
  flowOf(sessionId: string): SessionFlow | null;
}

interface ShownSample {
  sessionId: string;
  index: number;
  flow: SessionFlow;
}

export function createPreview(deps: PreviewDeps): Preview {
  const log = (line: string) => deps.log('workflow', line);
  // Made once per step, so its countdown runs down.
  let shown: ShownSample | null = null;
  let awaitingRow = false;

  const showStep = (sessionId: string, index: number) => {
    const flow = previewFlow(
      index,
      sessionId,
      deps.clock.now(),
      deps.autoStartSeconds(),
    );
    shown = { sessionId, index, flow };
    deps.showFlow(flow);
    log(
      `workflow preview step ${index + 1} of ${PREVIEW_STAGES.length}: ${PREVIEW_STAGES[index]}`,
    );
  };

  const close = (sessionId: string) => {
    shown = null;
    deps.closed(sessionId);
    log('workflow preview closed');
  };

  const open = () => {
    if (awaitingRow) {
      log('workflow preview still waits on the chat preview: asked again');
    }
    deps.openChatPreview();
    const sessionId = deps.previewSessionId();
    awaitingRow = sessionId === null;
    if (sessionId !== null) {
      showStep(sessionId, 0);
    }
  };

  return {
    press() {
      if (shown === null) {
        open();
        return;
      }
      const { sessionId, index } = shown;
      if (index + 1 < PREVIEW_STAGES.length) {
        showStep(sessionId, index + 1);
      } else {
        close(sessionId);
      }
    },
    sessionAdded(sessionId, hostSessionId) {
      if (awaitingRow && hostSessionId === CHAT_PREVIEW_HOST_ID) {
        awaitingRow = false;
        showStep(sessionId, 0);
      }
    },
    sessionRemoved(sessionId) {
      if (shown?.sessionId === sessionId) {
        shown = null;
      }
    },
    flowOf: (sessionId) => (shown?.sessionId === sessionId ? shown.flow : null),
  };
}
