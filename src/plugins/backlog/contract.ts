// The backlog plugin's channel between its main and page parts: every
// features home's follow-ups, plans and features, read through the docs
// index, and the follow-up writes and commit the main part makes.

import type { CommandKey } from '../../contracts/commands';
import type { GitCommit } from '../../contracts/git';
import type {
  ChannelShape,
  DependencyKey,
  EventShape,
} from '../../contracts/plugin';
import type { SlotKey } from '../../contracts/state';
import type {
  FollowupDraft,
  FollowupEdit,
  FollowupEditResult,
  FollowupItem,
} from '../../shared/followups/followup-file';

// A numbered task document; `path` is the index's copy of it. `copyPath` is
// the copy `status` was read from and the detail shows: in a plan's newer
// worktree copy when that copy's `plan.md` links the task, else `path`.
// `status` is its `Status:` line, null when absent; a worktree copy's line
// whose value is not a task status reads as null.
export interface BacklogTask {
  path: string;
  copyPath: string;
  title: string;
  status: string | null;
}

// `path` is the index's copy of the plan's `plan.md`, `copyPath` the copy
// `checked` and `total` were read from and the detail shows: the moved copy
// across the clone's checkouts. `title` is the index copy's first `# `
// heading less a trailing ` — plan`, else the plan folder's name; `target`
// and `written` from its `Target: … · Written: …` line, each null when
// absent.
export interface BacklogPlan {
  path: string;
  copyPath: string;
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
// `repoFolder`: the folder the repo's sessions start in and its follow-ups'
// named paths resolve against: the folder above `docs/features` for a home of
// that shape in a clone, else the `repoFolders` setting's folder for the repo;
// null when neither gives one.
export interface BacklogHome {
  repo: string;
  root: string;
  isCreateTarget: boolean;
  gitRoot: string | null;
  uncommitted: boolean;
  repoFolder: string | null;
  followupFiles: BacklogFollowupFile[];
  plans: BacklogPlan[];
  features: BacklogFeature[];
}

// `${repo}\n${title}`, built only by `rowKey` in `row-key.ts`.
export type RowKey = string;

// One element of the `repoFolders` setting: the folder `repo` starts sessions
// in, when its features home lies outside the repo. `folder` may start with
// `~`.
export interface RepoFolderSetting {
  repo: string;
  folder: string;
}

// One open follow-up's git staleness. `writtenAt`: the committer date of the
// commit that first added the item to its file, in the home's clone; null
// when the home is outside git, the item is not committed, or a git call
// failed. `namedPaths`: the paths its one line and body name that the repo
// folder holds the first segment of, relative to the repo folder.
// `gonePaths`: those of them missing from the repo folder. `commitsSince`:
// the commits after `writtenAt` that touched a named path, of the latest 100;
// `lastCommit` the newest of them. `level`: `stale` when a path is gone, else
// `moved` when a commit came since, else `unknown` when `writtenAt` is null,
// else `fresh`.
export interface BacklogStaleness {
  writtenAt: string | null;
  commitsSince: number;
  lastCommit: GitCommit | null;
  namedPaths: string[];
  gonePaths: string[];
  level: 'fresh' | 'moved' | 'stale' | 'unknown';
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

// Opens the home whose root is `arg`, as a click on its side bar row does.
export const backlogOpenHomeRowCommand: CommandKey<
  string,
  'backlog.openHomeRow'
> = { id: 'backlog.openHomeRow' };

// Selects the list row whose key is `arg` and focuses the items, as a click on
// the row does.
export const backlogSelectRowCommand: CommandKey<string, 'backlog.selectRow'> =
  { id: 'backlog.selectRow' };

export const backlogMainKey: DependencyKey<
  BacklogMainExports,
  'main',
  'backlog'
> = { id: 'backlog', process: 'main' };

// One follow-up edit landing, from the page or `fileNote`: a `setTags` is an
// edit, and a `fileNote` append edits the item it adds to. A refused edit fires
// none, and neither does a commit. `changed` stays the page's channel, since a
// file watch has no item to name.
export interface BacklogMainEvents extends EventShape {
  followupCreated: { homeRoot: string; title: string };
  followupEdited: { homeRoot: string; title: string };
  followupDeleted: { homeRoot: string; title: string };
}

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
    // The last load's open rows with a cached staleness still valid; main
    // reads the rest one row at a time and sends them in `stalenessRead`.
    staleness(): Promise<Record<RowKey, BacklogStaleness>>;
    // The commits since the row's item was written that touched a path it
    // names, newest first, read now. Rejects with `No Backlog row <key>`, its
    // newline shown as ` — `, when the last load holds no such row.
    commitsSince(key: RowKey): Promise<GitCommit[]>;
  };
  messages: {
    // A listed follow-up file changed, or a linked worktree's `docs/features`
    // or the worktree list of an in-git home's clone changed (`homeRoot` its
    // home), or the machine index reloaded or the `repoFolders` setting changed
    // (`homeRoot` null).
    changed: { homeRoot: string | null };
    // Staleness read since the last `stalenessRead`, ten rows or fewer.
    stalenessRead: { entries: Record<RowKey, BacklogStaleness> };
  };
}

// Where the list keys act: the side bar's homes, the open home's rows, or the
// detail pane.
export type BacklogFocus = 'homes' | 'items' | 'detail';

// Where the user was in Backlog mode, so a page reload puts them back:
// `homeCursor` indexes the side bar's homes in order, `selectedKey` is a row's
// key, and `expanded` the plan and feature paths whose task rows show.
export interface BacklogPlace {
  focus: BacklogFocus;
  homeCursor: number;
  openRoot: string | null;
  selectedKey: string | null;
  expanded: string[];
  filter: string;
}

export const backlogPlaceSlot: SlotKey<BacklogPlace, 'page', 'backlog'> = {
  id: 'backlog.place',
  process: 'page',
  kind: 'value',
};
