import type {
  ChatEntry,
  ProcessActivity,
  SessionControl,
} from '../../../contracts/agent';
import type { Paths } from '../../../contracts/paths';
import { NEEDS_YOU_ACTIVITY, type RowActivity } from '../../sessions/contract';
import type { ChatSessionState } from '../contract';
import { isWorkRunning } from '../session-work';

export type PermissionEntry = Extract<ChatEntry, { kind: 'permission' }>;

// An entry whose id the list holds replaces it in place; any other is
// appended.
export function applyEntry(
  entries: readonly ChatEntry[],
  entry: ChatEntry,
): { entries: ChatEntry[]; added: boolean } {
  const index = entries.findIndex((held) => held.id === entry.id);
  if (index < 0) {
    return { entries: [...entries, entry], added: true };
  }
  const replaced = [...entries];
  replaced[index] = entry;
  return { entries: replaced, added: false };
}

// The first unanswered permission entry, in list order.
export function oldestPendingPermission(
  entries: readonly ChatEntry[],
): PermissionEntry | null {
  for (const entry of entries) {
    if (entry.kind === 'permission' && entry.answer === null) {
      return entry;
    }
  }
  return null;
}

// What an idle session's row still shows of the agent's finished work until
// the user views the session or sends a message: `done` for a turn that ended
// with no subagent or background task left running while another session was
// focused, `error` for a process that stopped mid-turn or with an error.
export type Unseen = 'done' | 'error' | null;

const WORKING_ACTIVITY: RowActivity = {
  word: 'working',
  tone: 'running',
  rank: 20,
};
const DONE_ACTIVITY: RowActivity = { word: 'done', tone: 'success', rank: 10 };
const ERROR_ACTIVITY: RowActivity = { word: 'error', tone: 'error', rank: 30 };

// The activity chat sets on a session's row; null draws nothing. An idle
// session whose subagents or background tasks still run shows working.
export function rowActivity(state: {
  activity: ProcessActivity;
  background: number;
  unseen: Unseen;
}): RowActivity | null {
  if (state.activity === 'waiting') {
    return NEEDS_YOU_ACTIVITY;
  }
  if (isWorkRunning(state)) {
    return WORKING_ACTIVITY;
  }
  if (state.unseen === 'done') {
    return DONE_ACTIVITY;
  }
  return state.unseen === 'error' ? ERROR_ACTIVITY : null;
}

// An error outlasts the turn's end, which arrives after the process rested; a
// turn ending in the focused session, or with subagents or background tasks
// still running, leaves nothing unseen.
export function unseenAfterTurnEnd(
  unseen: Unseen,
  focused: boolean,
  background: number,
): Unseen {
  if (unseen === 'error') {
    return 'error';
  }
  return focused || background > 0 ? null : 'done';
}

// A process resting with an error, or while a turn ran, is an error even in
// the focused session.
export function unseenAfterRest(
  unseen: Unseen,
  error: string | null,
  wasActive: boolean,
): Unseen {
  return error !== null || wasActive ? 'error' : unseen;
}

// Whether the session's process works on a turn: waiting for a permission
// answer is not working.
export function isWorking(
  state: Pick<ChatSessionState, 'running' | 'activity'>,
): boolean {
  return state.running && state.activity === 'working';
}

// Whether the session's turn is under way: its process works on it, or waits
// on a permission answer.
export function isTurnUnderway(
  state: Pick<ChatSessionState, 'running' | 'activity'>,
): boolean {
  return state.running && state.activity !== 'idle';
}

// The label of the choice holding the control's value, else the raw value,
// else `unset` before the harness reports one.
export function valueLabel(control: SessionControl): string {
  if (control.value === null) {
    return 'unset';
  }
  const choice = control.choices.find(
    (candidate) => candidate.value === control.value,
  );
  return choice === undefined ? control.value : choice.label;
}

export function controlText(control: SessionControl): string {
  return `${control.label}: ${valueLabel(control)}`;
}

// The controls of `after` whose id is new or whose value differs from
// `before`, in `after`'s order.
export function changedControls(
  before: readonly SessionControl[],
  after: readonly SessionControl[],
): SessionControl[] {
  return after.filter((control) => {
    const earlier = before.find((held) => held.id === control.id);
    return earlier === undefined || earlier.value !== control.value;
  });
}

// The folder's last path segment, a trailing separator ignored; a root is
// named as it is written.
export function folderName(projectDir: string, paths: Paths): string {
  const base = paths.base(projectDir);
  return base === '' ? projectDir : base;
}
