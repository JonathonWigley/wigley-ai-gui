// The backlog plugin's channel between its main and page parts: every
// features home's follow-ups, plans and features, read through the docs
// index, and the follow-up writes and commit the main part makes.

import type { ChannelShape } from '../../contracts/plugin';
import type {
  FollowupEdit,
  FollowupEditResult,
  FollowupItem,
} from '../../shared/followups/followup-file';

// A numbered task document; `status` is its `Status:` line, null when absent.
export interface BacklogTask {
  path: string;
  title: string;
  status: string | null;
}

// `path` is the plan's `plan.md`; `title` its first `# ` heading less a
// trailing ` — plan`, else the plan folder's name; `target` and `written`
// from its `Target: … · Written: …` line, each null when absent.
export interface BacklogPlan {
  path: string;
  feature: string;
  title: string;
  checked: number;
  total: number;
  target: string | null;
  written: string | null;
  tasks: BacklogTask[];
}

// `path` is the feature's `checklist.md`.
export interface BacklogFeature {
  path: string;
  slug: string;
  checked: number;
  total: number;
  tasks: BacklogTask[];
}

export interface BacklogFollowupFile {
  path: string;
  items: FollowupItem[];
}

// One features home. `isCreateTarget`: the one home per repo a new follow-up
// goes to. `gitRoot`: the clone holding the home, null when it is in none.
// `uncommitted`: a follow-up file differs from HEAD.
export interface BacklogHome {
  repo: string;
  root: string;
  isCreateTarget: boolean;
  gitRoot: string | null;
  uncommitted: boolean;
  followupFiles: BacklogFollowupFile[];
  plans: BacklogPlan[];
  features: BacklogFeature[];
}

// `message`: the docs index load's line to show, null when none.
export interface BacklogRead {
  homes: BacklogHome[];
  message: string | null;
}

// `refused`: the docs guard refused the write, or the file kept changing on
// disk.
export type BacklogWriteResult =
  | FollowupEditResult
  | { type: 'refused'; reason: string };

// Every method rejects with main's own error text when its handler throws.
export interface BacklogChannel extends ChannelShape {
  invoke: {
    load(): Promise<BacklogRead>;
    // Rebuilds the machine index, then loads.
    rescan(): Promise<BacklogRead>;
    readDoc(path: string): Promise<string>;
    // `path` null: the home's create target file, created when missing.
    applyEdit(
      homeRoot: string,
      path: string | null,
      edit: FollowupEdit,
    ): Promise<BacklogWriteResult>;
    // Rejects with the git error text; resolves to the commit message used.
    commit(homeRoot: string): Promise<string>;
  };
  messages: {
    // A listed follow-up file changed (`homeRoot` its home), or the machine
    // index reloaded (`homeRoot` null).
    changed: { homeRoot: string | null };
  };
}
