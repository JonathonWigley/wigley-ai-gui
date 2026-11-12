// The backlog plugin's channel between its main and page parts: every
// features home's follow-ups, read through the docs index, each open
// follow-up's staleness, and the chunks the main part stores and starts.

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
// Removed in 08: main no longer serves this.
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
// Removed in 08: main no longer serves this.
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
// Removed in 08: main no longer serves this.
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
// `repoFolder`: the folder the repo's sessions start in and its follow-ups'
// named paths resolve against: the folder above `docs/features` for a home of
// that shape in a clone, else the `repoFolders` setting's folder for the repo;
// null when neither gives one.
export interface BacklogHome {
  repo: string;
  root: string;
  isCreateTarget: boolean;
  gitRoot: string | null;
  // Removed in 08: main no longer serves this. Main fills false.
  uncommitted: boolean;
  repoFolder: string | null;
  followupFiles: BacklogFollowupFile[];
  // Removed in 08: main no longer serves this. Main fills [].
  plans: BacklogPlan[];
  // Removed in 08: main no longer serves this. Main fills [].
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

// A named group of one repo's follow-ups for one session, in strip order.
// `titles` are its follow-ups' titles in its order; each one's row key is
// `rowKey(repo, title)`. `sessionId` is the session it started, null until it
// starts; a started chunk is retired when that session closes.
export interface BacklogChunk {
  id: string;
  repo: string;
  name: string;
  titles: string[];
  headless: boolean;
  sessionId: string | null;
}

// One change to the chunks. `add` with `chunkId` null makes a new chunk named
// after the first key's title.
export type ChunkEdit =
  | { type: 'add'; keys: RowKey[]; chunkId: string | null }
  | { type: 'remove'; keys: RowKey[] }
  | { type: 'rename'; chunkId: string; name: string }
  | { type: 'setHeadless'; chunkId: string; headless: boolean };

// One chunk's start: the session it started, or why it did not start.
export type ChunkStart =
  | { chunkId: string; sessionId: string }
  | { chunkId: string; refusal: string };

// A follow-up edit as the page sends it. An `edit` carries `baseline`, the
// item as the editor opened it.
// Removed in 08: main no longer serves this.
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

// One `fileNote` write landing: a create, or an append, which edits the item
// it adds to. A refused write fires none. `changed` stays the page's channel,
// since a file watch has no item to name.
export interface BacklogMainEvents extends EventShape {
  followupCreated: { homeRoot: string; title: string };
  followupEdited: { homeRoot: string; title: string };
}

// Every method rejects with main's own error text when its handler throws.
export interface BacklogChannel extends ChannelShape {
  invoke: {
    load(): Promise<BacklogRead>;
    // Rebuilds the machine index, then loads.
    rescan(): Promise<BacklogRead>;
    // Removed in 08: main no longer serves this.
    readDoc(path: string): Promise<string>;
    // `path` null: the home's create target file, created when missing; else
    // one of the home's follow-up files.
    // Removed in 08: main no longer serves this.
    applyEdit(
      homeRoot: string,
      path: string | null,
      edit: BacklogEdit,
    ): Promise<BacklogWriteResult>;
    // Rejects with the git error text; resolves to the commit message used.
    // Removed in 08: main no longer serves this.
    commit(homeRoot: string): Promise<string>;
    // The last load's open rows with a cached staleness still valid; main
    // reads the rest one row at a time and sends them in `stalenessRead`.
    staleness(): Promise<Record<RowKey, BacklogStaleness>>;
    // The commits since the row's item was written that touched a path it
    // names, newest first, read now. Rejects with `No Backlog row <key>`, its
    // newline shown as ` — `, when the last load holds no such row.
    commitsSince(key: RowKey): Promise<GitCommit[]>;
    // The stored chunks, in strip order.
    chunks(): Promise<BacklogChunk[]>;
    // Applies one edit, after dropping the titles the last load's rows no
    // longer hold from unstarted chunks and retiring each started chunk whose
    // session chat no longer holds; resolves to the chunks after it. A refused
    // edit rejects with the reason and changes nothing.
    editChunks(edit: ChunkEdit): Promise<BacklogChunk[]>;
    // Starts each chunk in order through chat's `launch`: one result per id,
    // in order.
    startChunks(chunkIds: string[]): Promise<ChunkStart[]>;
    // Asks the Backlog assistant to sweep the repo's follow-up files for
    // staleness; resolves to the assistant's sessionId. Rejects with
    // `No Backlog repo <repo>` when the last load holds no home of the repo.
    sweep(repo: string): Promise<string>;
  };
  messages: {
    // A listed follow-up file changed or `fileNote` wrote to it (`homeRoot`
    // its home), or the machine index reloaded or the `repoFolders` setting
    // changed (`homeRoot` null).
    changed: { homeRoot: string | null };
    // Staleness read since the last `stalenessRead`, ten rows or fewer.
    stalenessRead: { entries: Record<RowKey, BacklogStaleness> };
    // The chunks after a change to them, in strip order.
    chunksChanged: { chunks: BacklogChunk[] };
  };
}

// Where the list keys act: the side bar's homes, the open home's rows, or the
// detail pane.
export type BacklogFocus = 'homes' | 'items' | 'detail';

// Where the user was in Backlog mode, so a page reload puts them back:
// `homeCursor` indexes the side bar's homes in order, `selectedKey` is a row's
// key, and `expanded` the plan and feature paths whose task rows show. Main
// reads it for `read_backlog_state`.
// `repo`: the repo filter, null for every repo; `marked`: the marked rows'
// keys; the `is…` flags: the table's view toggles and whether the assistant
// pane shows. Optional until 08's page writes them.
export interface BacklogPlace {
  focus: BacklogFocus;
  homeCursor: number;
  openRoot: string | null;
  selectedKey: string | null;
  expanded: string[];
  filter: string;
  repo?: string | null;
  marked?: RowKey[];
  isReadyOnly?: boolean;
  isChunkedHidden?: boolean;
  isStaleFirst?: boolean;
  isDoneShown?: boolean;
  isAssistantShown?: boolean;
}

export const backlogPlaceSlot: SlotKey<BacklogPlace, 'page', 'backlog'> = {
  id: 'backlog.place',
  process: 'page',
  kind: 'value',
};
