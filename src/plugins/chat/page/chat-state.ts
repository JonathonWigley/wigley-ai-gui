import type {
  ChatEntry,
  ProcessActivity,
  SessionControl,
} from '../../../contracts/agent';
import type { Paths } from '../../../contracts/paths';

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

const TAB_STATUS: Record<ProcessActivity, string> = {
  working: 'working',
  waiting: 'waiting for permission',
  idle: '',
};

// A session's line in its sidebar row; empty while idle.
export function tabStatus(activity: ProcessActivity): string {
  return TAB_STATUS[activity];
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
