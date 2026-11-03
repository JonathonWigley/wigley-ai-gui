// The backlog plugin's channel between its main and page parts: every
// features home's follow-ups, plans and features, read through the docs
// index, and the follow-up writes and commit the main part makes.

import type { ChannelShape, DependencyKey } from '../../contracts/plugin';
import type {
  FollowupDraft,
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
// goes to, a home in git first. `gitRoot`: the clone whose `docs/features`
// folder the home is (compared on real paths); null for any other home, which
// counts as not in git. A home that is a linked worktree's `docs/features`
// folder is no home.
// `uncommitted`: a follow-up file, or a file in a folder of the home's
// `followups-images/`, differs from HEAD.
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

// A follow-up edit as the page sends it. An `edit` carries `baseline`, the
// item as the editor opened it.
export type BacklogEdit =
  | Exclude<FollowupEdit, { type: 'edit' }>
  | (Extract<FollowupEdit, { type: 'edit' }> & { baseline: FollowupDraft });

// `refused`: the title would not read back, the path is not one of the home's
// follow-up files, the docs guard refused the write, or the file kept
// changing on disk. `changed`: the item on disk no longer matches an edit's
// `baseline`; nothing was written, and `item` is the item as it now reads on
// disk.
export type BacklogWriteResult =
  | FollowupEditResult
  | { type: 'refused'; reason: string }
  | { type: 'changed'; title: string; item: FollowupDraft };

// Where `fileNote` puts a note: a new item, or the end of an existing item's
// body in the follow-up file at `path`.
export type NoteTarget =
  | { type: 'create'; title: string; oneLine: string; tags: string[] }
  | { type: 'append'; path: string; title: string };

// Backlog main's exports to the plugins that depend on it.
export interface BacklogMainExports {
  load(): Promise<BacklogRead>;
  // The tag list Backlog's tag picker offers: the backlog `tags` setting as
  // the user config now sets it.
  tags(): string[];
  // 'create' adds an item to the home's create-target file with `text` as its
  // body; 'append' adds `text` to the end of that item's body. Each PNG in
  // `images` is saved under the home's followups-images/ and linked after
  // `text`. A title that would not read back refuses before any image is
  // saved; a refused or failed follow-up write trashes the images it saved.
  // Rejects with `No Backlog home <homeRoot>` when `homeRoot` is not a home
  // of the last load, and with the read error when an 'append' target's file
  // cannot be read.
  fileNote(
    homeRoot: string,
    target: NoteTarget,
    text: string,
    images: readonly Uint8Array[],
  ): Promise<BacklogWriteResult>;
}

export const backlogMainKey: DependencyKey<
  BacklogMainExports,
  'main',
  'backlog'
> = { id: 'backlog', process: 'main' };

// Every method rejects with main's own error text when its handler throws.
export interface BacklogChannel extends ChannelShape {
  invoke: {
    load(): Promise<BacklogRead>;
    // Rebuilds the machine index, then loads.
    rescan(): Promise<BacklogRead>;
    readDoc(path: string): Promise<string>;
    // `path` null: the home's create target file, created when missing; else
    // one of the home's follow-up files.
    applyEdit(
      homeRoot: string,
      path: string | null,
      edit: BacklogEdit,
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
