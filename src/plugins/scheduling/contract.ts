// `ScheduledRunRecord` lives in `main/run-records.ts`: only the main part reads a run record.
import type { StartTarget } from '../chat/contract';
import type { LoginStartStatus } from '../../contracts/login-start';
import type { SessionControl } from '../../contracts/agent';
import type { SlotKey } from '../../contracts/state';
import type { ChannelShape } from '../../contracts/plugin';

// Local time. `time` is `HH:MM`, 24 h. `day` 0 is Sunday … 6. `at` is local `YYYY-MM-DDTHH:MM`.
export type TaskSchedule =
  | { kind: 'hourly'; minute: number }
  | { kind: 'daily'; time: string }
  | { kind: 'weekdays'; time: string } // Monday to Friday
  | { kind: 'weekly'; day: number; time: string }
  | { kind: 'once'; at: string }
  | { kind: 'cron'; line: string }; // five fields

export interface ScheduledTask {
  id: string; // 8 lowercase hex characters
  name: string;
  target: StartTarget; // a `projectDir` may start with `~`
  profile: string;
  prompt: string;
  schedule: TaskSchedule;
  controls: Readonly<Record<string, string>>; // harness control id → value, the permission mode included
  paused: boolean;
  // True: each run starts with headless off, and only while an app is connected to the session host.
  attended: boolean;
  updatedAt: number; // epoch ms of the app's last write of this task
}

// The demo step's sample tasks, which main holds in memory only. Not 8 hex characters, so no saved task's id equals one.
export const DEMO_TASK_IDS = {
  triage: 'demo-001',
  sweep: 'demo-002',
  dependencies: 'demo-003',
} as const;

// `~/.config/wigley-ai-gui/scheduled-tasks.json`.
export interface TaskFile {
  tasks: ScheduledTask[];
}
export const TASK_FILE_NAME = 'scheduled-tasks.json';

export type RunOutcome = 'running' | 'finished' | 'skipped' | 'failed';
// One history entry. `occurrence` is the schedule time the run stands for (a Run now's is its press time).
// `reason` is a failed run's reason, null otherwise. `rowId` is the run row's `sessionId`, the id `chat.adopt`
// resolved to; `rowId` and `processId` are null for a skipped or failed run. `viewed` is false from a run's start until
// the user views its row after it finished (a run that finishes while its row is selected is viewed at once); true for
// a skipped or failed run. Kept in `history.json`, so a finished run's unviewed mark survives an app restart.
export interface RunHistoryEntry {
  taskId: string;
  occurrence: number;
  at: number;
  outcome: RunOutcome;
  reason: string | null;
  rowId: string | null;
  processId: string | null;
  viewed: boolean;
}

export interface ScheduledTaskView {
  task: ScheduledTask;
  nextRun: number | null; // epoch ms; null while paused, for a spent one-time task, or where the app does not fire
  history: RunHistoryEntry[]; // newest first
}

export interface SchedulingState {
  tasks: ScheduledTaskView[];
  fileError: string | null; // the task file's parse error; the list holds the last good tasks
  fires: boolean; // false in the dev app
  loginStart: LoginStartStatus | null; // null where `fires` is false
  runRows: string[]; // every open run row's sessionId, oldest first
  unviewedRows: string[]; // open run rows whose history entry is `finished` with `viewed` false
}
export const schedulingStateSlot: SlotKey<
  SchedulingState,
  'main',
  'scheduling'
> = { id: 'scheduling.state', process: 'main', kind: 'value' };

// A task as the editor sends it: `id` null for a new task. Main sets `id` and `updatedAt`.
export type TaskDraft = Omit<ScheduledTask, 'id' | 'updatedAt'> & {
  id: string | null;
};

// What the editor offers: chat's profiles and project names, and the harness's start controls.
export interface EditorChoices {
  profiles: string[];
  projects: string[];
  controls: SessionControl[];
}

export interface SchedulingChannel extends ChannelShape {
  invoke: {
    saveTask(draft: TaskDraft): Promise<string>; // resolves to the task id; rejects with the reason
    setPaused(id: string, paused: boolean): Promise<void>;
    runNow(id: string): void;
    removeTask(id: string): Promise<void>;
    editorChoices(): EditorChoices;
  };
  messages: Record<never, never>;
}
