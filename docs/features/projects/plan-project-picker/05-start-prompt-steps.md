# 05 — Start prompt: Project, Branch and Other folder steps

Status: not started
Type: Task
Wave: 3 · Depends on: 03
Plan: [plan.md](plan.md)

The page start prompt opens on a Project step when settings hold projects: a pool project goes on to a Branch step,
the Profile step is skipped when the project fixes a profile, and the session step lists the project's saved sessions
from every folder it covers. `Other folder…` opens today's folder step unchanged. With no projects the prompt is
exactly today's.

Files:
- modify `src/plugins/chat/page/start-prompt.ts` · test `src/plugins/chat/page/start-prompt.test.ts`
- modify `src/plugins/chat/page/start-prompt-items.ts` · test `src/plugins/chat/page/start-prompt-items.test.ts`
- modify `src/plugins/chat/page/picker-row.ts` — the two new lists' row inputs
- modify `src/plugins/chat/page/resume-items.ts` — `sessionItems` for a step with no single folder · test
  `src/plugins/chat/page/resume-items.test.ts`
- modify `src/contracts/list-picker.ts` — `ListPickerRequest.keepFilter` · modify `src/shared/page/list-picker.ts` ·
  test `src/shared/page/list-picker.test.ts`

Consumes:
- `ChatProject` ← 02 (`src/plugins/chat/contract.ts`)
- `StartTarget`, `StartRequest`, `ProjectPastSessionRow` ← 03
- `ChatChannel.invoke`: `projects(): ChatProject[]`, `branches(project: string, refresh: boolean): Promise<string[]>`,
  `projectPastSessions(project: string, profile: string): Promise<ProjectPastSessionRow[]>`, and `start` taking the
  new `StartRequest` ← 03

Produces (`src/plugins/chat/page/start-prompt-items.ts`):
```ts
export type ProjectItem =
  | { kind: 'section'; section: string; row: ResumeSectionRow; label: string }
  | { kind: 'project'; project: ChatProject; label: string }
  | { kind: 'other'; label: string };
export const PROJECT_STEP_TITLE = 'Project';
export const BRANCH_STEP_TITLE = 'Branch';
export const OTHER_FOLDER_LABEL = 'Other folder…';
export const PROJECTS_HEADING = 'Projects';
// `<name> · <folder, ~ for the home folder>` or `<name> · <pool>`.
export function projectLabel(project: ChatProject, homeDir: string, paths: Paths): string;
// The section rows, then each project in settings order, then the other-folder line.
export function projectItems(projects: readonly ChatProject[], sections: readonly ResumeSectionRows[],
  homeDir: string, paths: Paths): ProjectItem[];
// The heading `item` sits under: its section, else PROJECTS_HEADING; null for every line of a step with no section rows.
export function projectSection(item: ProjectItem, showsSections: boolean): string | null;
// The index in `after` of the branch at `cursor` in `before`; 0 when `cursor` is null or `after` lacks it.
export function branchSelected(before: readonly string[], cursor: number | null, after: readonly string[]): number;
```
and in `src/plugins/chat/page/picker-row.ts`:
```ts
export function projectRowInput(item: ProjectItem, paths: Paths): PickerItemInput;
export function branchRowInput(branch: string): PickerItemInput;
```

## Decisions

- **Opening**: `openPrompt` invokes `projects` beside `recentFolders` and the sections. A `projects` call that
  rejects is logged (`projects not read: <reason>`) and reads as `[]`. With `[]` the prompt opens the folder step as
  today, so every existing test keeps passing on a fake answering `[]`. `PromptContext` gains
  `projects: readonly ChatProject[]`.
- **Project step** (title `Project`): `projectItems` lines; the cursor opens on the first project, below the section
  rows. Its `name` for filter ranking is the project's name (`''` for a section row, the label for `Other folder…`).
  Headings come from `projectSection`, so `Projects` shows over the projects and `Other folder…` only when section
  rows show. A section row resumes as on the folder step (`resumeSectionRow`); a project goes on by its kind; `Other
  folder…` calls `openFolderStep(context)` — the folder step unchanged, section rows included.
- **Label**: a folder project shows `paths.tilde(paths.expandTilde(folder, homeDir), homeDir)`, so a folder written
  with `~` or in full reads the same; a pool project shows its pool name. `New Games · new-games-prototypes`,
  `Wigley AI Dev · ~/Documents/ai-dev`.
- **Row inputs**: the layout contract (`src/plugins/chat/layouts/layout.d.ts`) has no project or branch list, and
  this plan changes no layout. A project, `Other folder…` and a branch row each draw as
  `{ list: 'choices', label, isCurrent: false }`, which the default layout draws as its label; a section row draws as
  the folder step's section row (`{ list: 'folder', kind: 'section', … }`, through `folderSectionDetail`).
- **Branch step** (title `Branch`, pool projects only): the prompt invokes `branches(name, false)` and
  `branches(name, true)` at once.
  - The first to answer opens the step with the cursor on row 0.
  - The refresh answering after the step opened, while that step's handle `isOpen()`, reopens it with
    `selected: branchSelected(shownList, picker.cursorIndex(), refreshed)` — only when the refreshed list differs
    from the shown one (same names in the same order is no change), and with `keepFilter: true`, so a filter the
    user typed while the fetch ran survives the reopen.
  - **`ListPickerRequest.keepFilter?: boolean`** (new, `src/contracts/list-picker.ts`, with a comment): when `open`
    runs while the picker is already open, the filter text stays and the new list opens filtered by it, the cursor
    on `selected` when that item passes the filter, else on the first item that does. Left out, or with the picker
    closed, `open` clears the filter as today. In `list-picker.ts` `open`, skip `filter?.setText('')` under that
    condition and apply the kept text to the new state the way a typed change does. Test (`list-picker.test.ts`,
    one `it.each` `open_KeepFilter_…` table): open `['main','protos/a','protos/b']`, type `protos`, reopen with
    `['main','protos/b','protos/c','protos/a']` and `selected` 3 → filter text `protos`, visible rows `protos/b`,
    `protos/c`, `protos/a`, cursor on `protos/a`; the same with `keepFilter` left out → filter empty, all four rows
    visible. Breaks caught: the filter cleared anyway; the text kept but the list drawn unfiltered; the cursor on a
    hidden item.
  - The cached read answering after the refresh is ignored.
  - A read that rejects is logged (`branches not read: <reason>`); when both reject, the prompt toasts
    `Branches not listed: <reason of the refresh>` and opens nothing.
  - Either answer arriving after the prompt opened again is dropped through `isStale`.
  - Picking a branch goes on to the profile.
- **Profile**: a project with `profile` set skips the Profile step and goes to the sign-in check under the
  `ChatProfile` of that name. A fixed profile not in `deps.profiles()` toasts
  `Profile <profile> of <project name> is not in chat's profiles setting` and starts nothing. A project with no
  `profile` takes today's rules (one profile asks nothing): a folder project pre-selects with
  `preselectedProfile(profiles, recent, expandTilde(folder), paths)`; a pool project pre-selects row 0, since the
  page holds no clone paths to match recent folders against.
- **Session step for a project**: lists `projectPastSessions(name, profile)`; with none it starts a new session at
  once, as the folder step does. Every row resumes in its own `projectDir`. Folder rows from `pastSessions` are
  mapped to `ProjectPastSessionRow` with the step's folder, so the step holds one row type and resume always reads
  `row.projectDir`.
- **Section rows on a project's session step**: `sessionItems` matches a section row to the step by folder;
  a project covers many folders, so its `step.projectDir` is null, meaning a section row is in the step when its
  profile matches and its session is among `rows` (already only the project's sessions).
- **Start**: `start({ ...target, profile, headless })` with target `{ projectDir }` for a folder pick,
  `{ project: name, branch }` for a pool project, `{ project: name, branch: null }` for a folder project.
- **`Ctrl+n`** (`openForNewSession`): the same Project, Branch and Profile steps with no section rows, and a new
  session at once after the sign-in check.
- **Page-internal target**: `start-prompt.ts` keeps a private
  `type PromptTarget = { kind: 'folder'; projectDir: string } | { kind: 'project'; project: ChatProject; branch: string | null }`
  carried from the pick to the start, and a private `startTargetOf(target): StartTarget`.

## Behaviour

GIVEN no projects in settings WHEN `Space b n` THEN the folder step opens exactly as today.
GIVEN projects New Games (pool, profile `work`, pinned `main`) and Wigley AI Dev (folder, no profile) WHEN `Space b n`
THEN the Project step lists the section rows, `New Games · new-games-prototypes`, `Wigley AI Dev · ~/Documents/ai-dev`,
`Other folder…`, the cursor on New Games.
GIVEN the Project step WHEN `Other folder…` is picked THEN the folder step opens as today.
GIVEN New Games picked WHEN the cached branches answer `['main', 'a']` THEN the Branch step lists them; WHEN the
cursor is on `a` and the refresh answers `['main', 'b', 'a']` THEN the step reopens on `a` (index 2).
GIVEN branch `main` picked on New Games THEN no Profile step opens; once `work` reads signed in the session step lists
`projectPastSessions('New Games', 'work')`.
GIVEN a past row with `projectDir` `/c/3` WHEN it is picked THEN `resume` runs with `projectDir: '/c/3'`.
GIVEN the new-session line WHEN picked THEN `start({ project: 'New Games', branch: 'main', profile: 'work',
headless: false })`.
GIVEN Wigley AI Dev picked with profiles `work`, `personal` and a recent use of `/Users/u/Documents/ai-dev` under
`personal` THEN the Profile step opens on `personal`.
GIVEN `Ctrl+n` WHEN New Games and `main` are picked THEN `start` runs at once after the sign-in check, with no
`projectPastSessions` call.

## Tests

The `start-prompt.test.ts` harness (`setUp`) gains answers `projects` (default `() => Promise.resolve([])`),
`branches(project, refresh)` and `projectPastSessions`, and records the arguments of each. Fixtures in the test:
`newGames: ChatProject = { kind: 'pool', name: 'New Games', pool: 'new-games-prototypes', profile: 'work',
pinnedBranches: ['main'] }`, `aiDev: ChatProject = { kind: 'folder', name: 'Wigley AI Dev', folder:
'~/Documents/ai-dev', profile: null }`.

`src/plugins/chat/page/start-prompt-items.test.ts`:
- `projectLabel: $name` — `it.each`: pool → `New Games · new-games-prototypes`; folder with `~` →
  `Wigley AI Dev · ~/Documents/ai-dev`; folder in full `/Users/u/Documents/ai-dev` → the same. Break: the full
  path shown raw, or `~` doubled.
- `projectItems_SectionsThenProjectsThenOtherFolder` — two projects and one section row: kinds in order
  `['section', 'project', 'project', 'other']`, projects in settings order, the last label `Other folder…`; with
  sections `[]`, `['project', 'project', 'other']`.
- `projectSection: $name` — rows: section row → its section; project with sections shown → `Projects`; other line
  with sections shown → `Projects`; project with none shown → null.
- `branchSelected: $name` — `it.each`:

  | name | before | cursor | after | expected |
  |---|---|---|---|---|
  | moved down by a new branch | `['main', 'a']` | 1 | `['main', 'b', 'a']` | 2 |
  | gone | `['main', 'a']` | 1 | `['main', 'b']` | 0 |
  | no cursor | `['main']` | null | `['x', 'main']` | 0 |
  | moved up | `['main', 'b', 'a']` | 2 | `['a', 'main']` | 0 |

  Breaks: keeping the index rather than the branch (row 1 lands on `b`); an out-of-range index when the branch is
  gone.

`src/plugins/chat/page/resume-items.test.ts`:
- `sessionItems_SectionRows_ShowOnlyMatchingAndOnce` gains rows for `step.projectDir` null: a section row in another
  folder whose session is in `rows` with the step's profile shows; one with another profile does not. Break: null
  matching nothing (the project's step loses its section rows) or matching across profiles.

`src/plugins/chat/page/start-prompt.test.ts`:
- `open_ProjectsReject_OpensTheFolderStep` — `projects` rejects; the first picker is titled `Folder`; the log holds
  `projects not read:`. (No projects at all is already the default of every existing test.)
- `open_Projects_OpensTheProjectStepOnTheFirstProject` — with `closedAlpha` in a section: title `Project`, labels
  section row, `New Games · new-games-prototypes`, `Wigley AI Dev · ~/Documents/ai-dev`, `Other folder…`; `selected` 1.
- `projectStep_OtherFolder_OpensTheFolderStep` — the next picker's title and labels equal what
  `open_opensTheFolderStepWithRecentThenChoose` shows.
- `projectStep_SectionRow_Resumes` — picking the section row resumes it with its own `projectDir`.
- `branchStep_CachedThenRefreshed_KeepsTheCursorsBranch` — cached `['main', 'a']` answers first, the refresh held on
  a `deferred`; move the cursor to `a`; settle the refresh with `['main', 'b', 'a']`; the step opened twice, the
  second with those labels, `selected` 2 and `keepFilter` true. `branches` called with `('New Games', false)` and
  `('New Games', true)`.
- `branchStep_RefreshUnchanged_DoesNotReopen` — both answer `['main', 'a']`; `Branch` opened once.
- `branchStep_RefreshAfterBranchPicked_ReopensNothing` — pick `main` before the refresh settles; no second `Branch`
  picker after it lands.
- `branchStep_CachedRejects_OpensOnTheRefresh` — the step opens once, on the refresh's list.
- `branchStep_BothReject_Toasts` — toast `Branches not listed: offline` (tone `error`), no `Branch` picker.
- `startPrompt_ReopenedWhileBranchesRead_OpensNoBranchStep` — open, pick New Games, open again, settle the reads:
  no `Branch` picker after the second open.
- `projectProfile: $name` — `it.each`, profiles `[work, personal]`, recent `[{ projectDir:
  '/Users/u/Documents/ai-dev', profile: 'personal', lastUsed: 3 }]`:

  | name | project | expected |
  |---|---|---|
  | fixed profile skips the step | New Games, `main` picked | no `Profile` picker; `accountStatus` asked for `work` |
  | folder project pre-selects its last use | Wigley AI Dev | `Profile` picker, `selected` 1 |
  | pool project with no profile | New Games with `profile: null` | `Profile` picker, `selected` 0 |
  | fixed profile not in settings | New Games with `profile: 'gone'` | toast `Profile gone of New Games is not in chat's profiles setting`, nothing started |

  Breaks: the Profile step asked for a fixed profile; pre-selection matched against the unexpanded `~` folder.
- `projectSessionStep_ListsTheProjectsSessions_ResumesInEachRowsFolder` — `projectPastSessions` answers two rows in
  `/c/1` and `/c/3`; called with `('New Games', 'work')`; picking the `/c/3` row resumes with `projectDir: '/c/3'`.
  Break: resuming in a single step folder.
- `projectNewSession: $name` — `it.each`: New Games with `main` → `{ project: 'New Games', branch: 'main', profile:
  'work', headless: false }`; Wigley AI Dev with `work` → `{ project: 'Wigley AI Dev', branch: null, profile: 'work',
  headless: false }`. Picked from the session step's new-session line.
- `projectPastSessionsEmpty_StartsAtOnce` — `[]` → `start` runs with no session step.
- `openForNewSession_Project_StartsWithoutTheSessionStep` — the Project step has no section rows; after `main`,
  `start` runs and `projectPastSessions` is never invoked.

## Doc comments to update

- `StartPrompt` (start-prompt.ts): "`open` asks for a folder, then a profile…" becomes: asks for a project — or,
  through `Other folder…` or with no projects, a folder — then a branch for a pool project, then a profile unless the
  project fixes one or there is one, then signs in, then a new or saved session of the project or folder. The
  section rows sit at the top of the first step. `openForNewSession` the same, with no sections and no session step.
- `SessionStep`: `projectDir` becomes `target: PromptTarget`; `rows` becomes `ProjectPastSessionRow[]`, each resuming
  in its own folder.
- `PromptContext`: the new `projects` field.
- `listSessions`, `checkProfile`, `openProfileStep`, `startSession`: take `PromptTarget` in place of `projectDir`;
  each comment names the project case (`projectPastSessions`, the fixed profile, the start target).
- `sessionItems` (resume-items.ts): "the section rows of `step`'s folder and profile" adds "— any folder when
  `step.projectDir` is null".
- `picker-row.ts`: the file comment stands; the two new functions say they draw as a `choices` row.

Done when: `npm run typecheck` and `npm run lint` pass, and vitest passes on
`src/plugins/chat/page/start-prompt.test.ts`, `src/plugins/chat/page/start-prompt-items.test.ts` and
`src/plugins/chat/page/resume-items.test.ts`.

Commit: one commit for the group — "Start prompt opens on a Project step: a Branch step for a pool project, the
profile a project fixes, the project's saved sessions from every folder it covers, and Other folder… for the old
folder step".

## Proof
