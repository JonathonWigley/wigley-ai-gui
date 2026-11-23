# 04 — Work plugin skeleton, contract and store

Status: done
Type: Task
Rung: deep · adds the persisted `work.json` format, its parse, and an atomic serial write chain that never overwrites a bad file, which every later work task builds on
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Paths are relative to `wigley-ai-gui/`.

Files:
- create `src/plugins/work/manifest.ts`
- create `src/plugins/work/contract.ts` · test `src/plugins/work/contract.test.ts`
- create `src/plugins/work/main/store.ts` · test `src/plugins/work/main/store.test.ts`
- create `src/plugins/work/main/start.ts` · test `src/plugins/work/main/start.test.ts`
- create `src/plugins/work/page/start.ts` · test `src/plugins/work/page/start.test.ts`
- modify `src/plugins/main.ts` · modify `src/plugins/manifests.ts` · modify `src/plugins/page.ts`

Consumes: nothing from another task. From the tree: `definePlugin` (`src/shared/define-plugin.ts`), `SlotKey` (`src/contracts/state.ts`), `CommandKey` (`src/contracts/commands.ts`), `ChannelShape`, `MainPart`, `PagePart`, `MainApi`, `PageApi` (`src/contracts/plugin.ts`), `Files`, `readIfPresent` (`src/contracts/files.ts`), `Disposable` (`src/contracts/disposable.ts`), `PluginLog` (`src/contracts/log.ts`), `isJsonObject`, `isStringArray` (`src/shared/json.ts`), `errorText` (`src/shared/error-text.ts`).

Produces:

`src/plugins/work/manifest.ts`
- `export const workManifest` (`definePlugin({ id: 'work', … })`), every field in Pinned values.

`src/plugins/work/contract.ts` — the plan's shared names, with every field typed:
```ts
export type WorkSection = 'needs_you' | 'promised' | 'waiting' | 'my_threads' | 'around' | 'worth_knowing'
export const WORK_SECTIONS: readonly WorkSection[]          // in the order above, the Inbox's order
export type WorkSignal = 'branch' | 'commit' | 'pr_opened' | 'pr_merged' | 'session'
export const WORK_SIGNALS: readonly WorkSignal[]           // in the order above
export type WorkItemState = 'open' | 'cleared' | 'dismissed' | 'snoozed'
export interface WorkItem {
  id: string                 // the Slack permalink of the conversation's root message
  section: WorkSection
  channel: string            // '#name', 'DM' or 'group DM'
  author: string             // the root message's author
  at: string                 // ISO time of the conversation's latest message
  title: string
  summary: string
  latest: string             // the latest reply, as 'Name: text'
  participants: string[]
  url: string                // the permalink to open
  ticketKeys: string[]
  linkReason: string | null  // why the worker linked a key the conversation does not name
  why: string | null         // around and worth_knowing: one line on why it matters
  draft: string | null       // needs_you: the drafted reply; waiting: the drafted nudge
  state: WorkItemState
  snoozedUntil: string | null  // ISO; set only while state is 'snoozed'
  firstSeen: string          // ISO time the store first recorded it
  note: string | null        // the last failed Send's note
  sending: string | null     // the text of a queued or running Send or nudge; null when none
}
export interface WorkColumnSetting { name: string; jiraStatuses: string[] }
export interface WorkProjectSetting { jiraProject: string; project: string }
export type WorkSignalSetting = Record<WorkSignal, string>   // a column name, or 'off'
interface WorkCardBase {
  id: string                 // a Jira card's key; a local task's 'local-<uuid>'
  title: string
  url: string | null         // a Jira card's ticket URL; a local task's source item URL, null with none
  column: string             // see Decisions: derived for a Jira card, owned by a local task
  movingTo: string | null    // the column a queued or running Move job targets; always null on a local task
  note: string | null        // the last failed job's note on this card
  linkedSessionIds: string[] // row ids (chat.launch's result) of sessions started from the card
  movedAt: string | null     // ISO time of the card's last move; null for none seen
}
export type WorkCard =
  | (WorkCardBase & { kind: 'jira'; key: string; jiraStatus: string; priority: string | null;
                      reachableStatuses: string[] | null })   // null: not read yet
  | (WorkCardBase & { kind: 'local'; sourceItemId: string | null })
export interface WorkSuggestion { cardId: string; signal: WorkSignal; column: string; reason: string; at: string;
                                  state: 'suggested' | 'done' }
export type WorkJobKind = 'sweep' | 'send' | 'move' | 'nudge'
export type WorkJob =
  | { kind: 'sweep' }
  | { kind: 'send'; itemId: string; text: string }
  | { kind: 'nudge'; itemId: string; text: string }
  | { kind: 'move'; key: string; column: string }
export interface WorkJobStatus { kind: WorkJobKind; state: 'queued' | 'running' | 'done' | 'failed';
                                 rowId: string | null; at: string; note: string | null }
export interface WorkState {
  items: WorkItem[]; cards: WorkCard[]; suggestions: WorkSuggestion[];
  columns: string[];         // work.columns' names in order, then OTHER_COLUMN
  job: { running: WorkJobStatus | null; last: WorkJobStatus | null };
  problem: string | null;    // why work.json was not read at start, so nothing saves this run; else null
}
export const OTHER_COLUMN = 'Other'
export function columnForStatus(status: string, columns: readonly WorkColumnSetting[]): string
export function ticketKeysIn(text: string): string[]
export function readColumns(raw: unknown): WorkColumnSetting[]     // work.columns as stored: well-formed entries only
export function readProjects(raw: unknown): WorkProjectSetting[]   // work.projects as stored: well-formed entries only
export interface WorkStatusLine { text: string; tone: 'idle' | 'running' | 'success' | 'error'; hasRow: boolean }
export function statusLine(job: WorkState['job'], now: number): WorkStatusLine   // the one status-line rule for both views
export const workStateSlot: SlotKey<WorkState, 'main', 'work'>   // { id: 'work.state', process: 'main', kind: 'value' }
export interface WorkSendArg { itemId: string; text: string }
export interface WorkMoveArg { cardId: string; column: string }
export interface WorkStartArg { source: string; id: string }   // source 'item' or 'card'
export const workSendCommand: CommandKey<WorkSendArg, 'work.send'>
export const workMoveCardCommand: CommandKey<WorkMoveArg, 'work.moveCard'>
export const workStartSessionCommand: CommandKey<WorkStartArg, 'work.startSession'>
export interface WorkChannel extends ChannelShape {
  invoke: {
    sweep(): Promise<void>
    send(arg: WorkSendArg): Promise<void>
    dismiss(itemId: string): Promise<void>
    restore(itemId: string): Promise<void>
    snooze(itemId: string): Promise<void>
    addToBoard(itemId: string): Promise<void>
    moveCard(arg: WorkMoveArg): Promise<void>
    acceptSuggestion(cardId: string): Promise<void>
    notYet(cardId: string): Promise<void>
    deleteTask(cardId: string): Promise<void>
    startSession(arg: WorkStartArg): Promise<void>
    openJobRow(): Promise<void>
  }
  messages: Record<never, never>
}
```

`src/plugins/work/main/store.ts`
```ts
export const WORK_FILE = 'work.json'
export interface WorkNotYet { cardId: string; signal: WorkSignal; at: string }   // `at`: the signal time Not yet hid
export interface WorkFile {
  items: WorkItem[]; cards: WorkCard[]; suggestions: WorkSuggestion[]; notYet: WorkNotYet[];
  job: WorkState['job']; lastSweepAt: string | null;
}
export const EMPTY_WORK_FILE: WorkFile
export function parseWorkFile(text: string): WorkFile
export function buildWorkState(file: WorkFile, columns: readonly WorkColumnSetting[], problem: string | null): WorkState
export interface WorkStore {
  load(): Promise<void>
  file(): WorkFile
  update(change: (file: WorkFile) => WorkFile): Promise<WorkFile>
  onChange(listener: (file: WorkFile) => void): Disposable
  problem(): string | null
  settled(): Promise<void>
}
export function createWorkStore(data: Files, log: PluginLog): WorkStore
```

`src/plugins/work/main/start.ts`: `export const workMainPart: MainPart<typeof workManifest>`.
`src/plugins/work/page/start.ts`: `export const workPagePart: PagePart<typeof workManifest>`.

Decisions:
- **Commands run in the page** (plan.md File Structure: page-runnable, with a channel). Each page handler is one `api.channel.invoke(<same name>, context.arg)` and returns its promise, so a reporting run (`commands.runFor`) sees main's rejection. The page part draws nothing and reads no slot. Main handles no channel method in this task; 08 and 09 add the handlers, so until then an invoke rejects.
- **No scopes or keys here.** The views own the scopes, and 12 binds `W` in `src/plugins/keymap.ts`.
- **`demoSkip`**: the plugin draws nothing, and the Inbox and Board views' demo steps show its state (10, 11).
- **`dependsOn.main: ['chat', 'sessions']`, `page: []`; `reads.main: ['unity-pool']`, `page: []`.** Chat covers `launch`, `close`, `restored`, `defaultProfile`, `projects`, its events and `chat.session` (05, 07, 08). Sessions covers `contributeTools`, `setTitle` and `sessions.rows` (05, 06, 07). `unity-pool` is read only for `unity-pool.snapshot`'s clone paths, the pool clones detection watches (07). `reads` carries no start order, so the plugin runs with unity-pool switched off.
- **`work.projects` is a list of `{ "jiraProject", "project" }`, not design.md's `{}` map.** A plain-object default recurses into dotted setting paths, so an empty object has no leaf to declare in `settingInfo`. `user-settings.ts` would also refuse any key written under it as "not a setting". Task 13's re-read fixes design.md § Settings' row.
- **`work.signals` is an object with one leaf per signal** (`signals.branch` … `signals.session`), each a column name or `off`. Each leaf gets its own Settings row and `settingInfo` entry.
- **The columns that cards fall in.** A Jira card's `column` is `columnForStatus(jiraStatus, work.columns)`, set by `buildWorkState` on every slot build. The stored value is never read, so a changed `work.columns` re-sorts the Board at once. A local task's `column` is its own, kept in the store. `columnForStatus` returns the first column whose `jiraStatuses` holds the status, compared case-insensitively after trimming, else `OTHER_COLUMN`. `WorkState.columns` always ends with `OTHER_COLUMN`, so a view hides it when it is empty.
  - A local task whose stored `column` is not among `work.columns`' names (the user renamed or dropped it) shows in `OTHER_COLUMN`: `buildWorkState` sets its slot `column` to `OTHER_COLUMN` and leaves the stored value as it is, so restoring the column's name brings the card back to it. So every card is on a column the slot lists.
- **`statusLine` is the one status-line rule.** Both views draw it; its copy is the list under Pinned values in task 10 (kind words `Sweep`, `Send`, `Move`, `Nudge`; `<ago>` is `just now` under a minute, `<n>m ago`, `<n>h ago` under 48 hours, else `<n>d ago`; forms none, queued, running, done and failed with their tones; a set `note` adds ` · <note>`). It describes `running ?? last`. `hasRow` is `last !== null && last.rowId !== null`: the job writers (05, 09) keep `rowId` on `last` only while that row has a saved record chat can reopen, and null it otherwise, so the view needs no other field.
- **Array settings are read through `readColumns` and `readProjects`.** The settings check types an array setting as a leaf and checks no element (chat's `ProjectSetting` comment says the same of `chat.projects`). So a hand-written `work.columns` or `work.projects` can hold anything, and every reader goes through these two (this task's main start, 06's `columns()`, 07, 08 and 09):
  - `readColumns(raw)` returns `[]` for a value that is no list. It keeps each element that is an object with a non-empty string `name` and a `jiraStatuses` list of strings, as `{ name, jiraStatuses }`, and drops the rest. A name already kept drops the later entry (first wins). A name equal to `OTHER_COLUMN` is dropped too, since the slot adds that column itself.
  - `readProjects(raw)` returns `[]` for a value that is no list. It keeps each element that is an object with non-empty strings `jiraProject` and `project`, and drops the rest. A `jiraProject` already kept drops the later entry.
  - Neither logs nor throws: the Settings page shows the raw value, and a dropped entry simply has no effect.
- **`ticketKeysIn`** returns the distinct matches of `/\b[A-Z][A-Z0-9]+-\d+\b/g` in first-seen order. It is the one key pattern, used by 06's item merge and offered to 07.
- **The store** follows `src/plugins/auto-retro/main/queue-file.ts`:
  - It keeps one file, `work.json`, in the plugin data, written whole and atomically through `api.data.write` as `JSON.stringify(file, null, 2)`.
  - `load()` runs once and never rejects. A missing file reads as `EMPTY_WORK_FILE`. A file that `parseWorkFile` throws on, or that cannot be read, logs `work.json not read: <errorText>` and sets `problem()` to `work.json could not be read, so nothing is saved this run: <errorText>`. Then every later `update` applies in memory and writes nothing, so a bad file is never overwritten and the user's local tasks and dismissals in it survive for a hand fix.
  - `update(change)` is one serial chain. It waits for `load` and every earlier update, then applies `change` to the file as it is then and saves. It calls each `onChange` listener with the new file and resolves to that file.
  - Each listener runs in its own `try`. A listener that throws logs `work listener failed: <errorText>`, and the other listeners still run and the update still resolves to the new file. 09 hangs the slot republish, detection, the badge and the snooze timer on this path, so one failing must not stop the rest or reject a press.
  - A `change` that throws rejects that update and leaves the file and listeners untouched. The chain goes on.
  - A failed write logs `work.json not written: <errorText>` and still resolves, since memory holds the truth.
  - `settled()` resolves once every update asked so far has settled.
- **`parseWorkFile`** checks every top-level key's kind and each element's fields by their kinds, as `retro-queue.ts`'s `parseQueue` does. Any failure throws `work.json is not a work file`. A file only this app writes has no legacy shape to accept, and the user is the app's only user.
- **Minimal main start**: it creates the store, publishes `workStateSlot` (`api.state.publish`) and loads the store. The slot holds no value until the load ends: the views take `WorkState | undefined` (10, 11) and draw nothing for it, so no empty Inbox flashes before the saved one. It then writes `buildWorkState(store.file(), readColumns(api.settings().columns), store.problem())` after the load, on each `onChange`, and on `onSettingsChanged`. `dispose` awaits `store.settled()`. It returns `{ commands: {} }` and runs the same way in the self-test. Task 09 adds the fixture, the timer, the tools, the runner and the channel handlers.
- **Registration**:
  - `workManifest` joins `builtInManifests` right after `backlogManifest`.
  - `workMainPart` joins `mainParts` right after `backlogMainPart`.
  - `workPagePart` joins `src/plugins/page.ts`'s list right after `backlogPagePart`. The page part must start, or the page commands have no handler. plan.md's File Structure lists `main.ts`, `page.ts` and `manifests.ts` under both this task (register `work`) and 12 (register the views). 12 runs in a later wave, so the two edits never meet.

Pinned values:
- id `work`. Label `Work`. Description `Brings the user's Slack and Jira work into the app: the store, the worker jobs, work detection and every card action, for the Inbox and Board views.`
- demoSkip: `A data plugin: the Inbox and Board views draw its state, and their demo steps show it.`
- `scopes: {}` and `themeTokens: {}`, as `definePlugin` requires them and the plugin owns neither.
- commands, each `group: 'work'`, `runsIn: 'page'`:

  | id | label | arg |
  |---|---|---|
  | `sweep` | `sweep Slack and Jira now` | none |
  | `send` | `send the reply or nudge` | `{ itemId: 'string', text: 'string' }` |
  | `dismiss` | `dismiss the item` | `'string'` |
  | `restore` | `restore the item` | `'string'` |
  | `snooze` | `snooze the item for a day` | `'string'` |
  | `addToBoard` | `add the item to the Board as a local task` | `'string'` |
  | `moveCard` | `move the card to a column` | `{ cardId: 'string', column: 'string' }` |
  | `acceptSuggestion` | `accept the suggested move` | `'string'` |
  | `notYet` | `hide the suggested move until a newer signal` | `'string'` |
  | `deleteTask` | `delete the local task` | `'string'` |
  | `startSession` | `start a session from the item or card` | `{ source: 'string', id: 'string' }` |
  | `openJobRow` | `open the worker job's transcript` | none |

- settings, with their defaults and `settingInfo`:

  | path | default | label | description |
  |---|---|---|---|
  | `profile` | `''` | `Worker profile` | `The profile worker jobs run on; empty for chat's default profile.` |
  | `intervalMinutes` | `10` | `Sweep interval (minutes)` | `Minutes between sweeps while the app runs; 0 for never.` |
  | `lookbackHours` | `48` | `First look back (hours)` | `How far back the first sweep reads Slack.` |
  | `channels` | `[] as string[]` | `Watched channels` | `Slack channels (no #) read for Around Slack.` |
  | `broadcastChannels` | `['general', 'announcements'] as string[]` | `Broadcast channels` | `Slack channels (no #) whose important posts go to Worth knowing.` |
  | `keywords` | `[] as string[]` | `Keywords` | `Words that make a Slack post relevant.` |
  | `stallHours` | `24` | `Stall hours` | `Hours of quiet before a thread counts as Waiting on others.` |
  | `jiraQuery` | `'assignee = currentUser() AND (statusCategory != Done OR resolved >= -14d) ORDER BY updated DESC'` | `Jira query` | `The JQL for the Board's tickets.` |
  | `columns` | Backlog: `['Backlog']`; Todo: `['To Do', 'Selected for Development', 'Open']`; In Progress: `['In Progress']`; In QA: `['In QA', 'QA', 'In Review', 'Ready for QA']`; Done: `['Done', 'Closed', 'Resolved']`, as `WorkColumnSetting[]` in that order | `Board columns` | `The Board's columns in order, each { "name", "jiraStatuses" }: the Jira statuses the column stands for.` |
  | `signals.branch` | `'In Progress'` | `Branch signal` | `The column a branch with the ticket's key suggests, or off.` |
  | `signals.commit` | `'In Progress'` | `Commit signal` | `The column a commit with the ticket's key suggests, or off.` |
  | `signals.pr_opened` | `'In QA'` | `PR opened signal` | `The column an open pull request for the ticket suggests, or off.` |
  | `signals.pr_merged` | `'Done'` | `PR merged signal` | `The column a merged pull request, with none open, suggests, or off.` |
  | `signals.session` | `'In Progress'` | `Session signal` | `The column a session linked to the card suggests, or off.` |
  | `repoFolders` | `[] as string[]` | `Repo folders` | `Folders watched beyond chat's projects and their pool clones.` |
  | `projects` | `[] as WorkProjectSetting[]` | `Projects` | `The Auri project each Jira project starts sessions in: a list of { "jiraProject", "project" }.` |

- slot id `work.state`. File `work.json`. Log lines `work.json not read: <error>`, `work.json not written: <error>` and `work listener failed: <error>`. Parse error `work.json is not a work file`. The problem text is as in Decisions.
- `EMPTY_WORK_FILE`: `{ items: [], cards: [], suggestions: [], notYet: [], job: { running: null, last: null }, lastSweepAt: null }`.

GIVEN no `work.json` WHEN the main part starts THEN `work.state` holds no items, cards or suggestions, the five columns then `Other`, `job` with both null, and `problem` null
GIVEN a `work.json` that is not JSON WHEN the store loads and an update runs THEN the slot's `problem` names the file, the update's change shows in the slot, and the file on disk is byte-for-byte unchanged
GIVEN two updates asked back to back WHEN both settle THEN the second change saw the first's result, and the file holds both
GIVEN a Jira card with status `In Review` and the default columns WHEN the slot builds THEN its column is `In QA`; with status `Blocked` it is `Other`
GIVEN a local task in column `Review` and `work.columns` holding no `Review` WHEN the slot builds THEN it shows in `Other`, and the stored column is still `Review`
GIVEN a `work.columns` holding an entry with no `jiraStatuses`, a non-string name and a duplicate name WHEN the slot builds THEN those entries are dropped and the build does not throw
GIVEN an `onChange` listener that throws WHEN an update runs THEN the other listeners run, the update resolves to the new file, and the log holds `work listener failed: …`
GIVEN the page runs `work.moveCard` with `{ cardId: 'WS-1', column: 'Done' }` WHEN the handler runs THEN the channel's `moveCard` is invoked with that arg, and the run rejects with main's text when main rejects

Tests:
- `contract.test.ts` › `columnForStatus` table:

  | status | columns | result |
  |---|---|---|
  | `In Review` | default | `In QA` |
  | ` in review ` | default | `In QA` |
  | `Blocked` | default | `Other` |
  | `Open` | default | `Todo` |
  | `Done` | `[]` | `Other` |

- `contract.test.ts` › `readColumns` table: not a list → `[]`; a well-formed entry kept; an entry with no `jiraStatuses`, a non-string `name`, an empty `name`, `jiraStatuses` holding a number, and a `null` element each dropped; a duplicate name keeps the first; a column named `Other` dropped.
- `contract.test.ts` › `readProjects` table: not a list → `[]`; a well-formed entry kept; a missing `project`, an empty `jiraProject` and a `null` element each dropped; a duplicate `jiraProject` keeps the first.
- `contract.test.ts` › `statusLine` table, with `now` fixed: no job → `No job yet`, `idle`, no row; a queued send → `Send queued`, `running`; a sweep running 3 minutes → `Sweep running · started 3m ago`, `running`; a move done 2 hours ago → `Move done 2h ago`, `success`; a nudge failed 3 days ago with note `x` → `Nudge failed 3d ago · x`, `error`; a running job is described over `last`; `hasRow` true only when `last.rowId` is set, also while a job runs, and false when `last` is null or its `rowId` is null.
- `contract.test.ts` › `ticketKeysIn` table: `'WS-12 and ABC-3, WS-12'` → `['WS-12', 'ABC-3']`; `'ws-12'` → `[]`; `'feature/WS-40-board'` → `['WS-40']`; `'A-1'` → `[]` (a key's project part has 2 or more characters).
- `store.test.ts`, over an in-memory `Files` fake:
  - `load_missingFile_readsEmpty` — `file()` equals `EMPTY_WORK_FILE` and `problem()` is null.
  - `load_unreadableFile_setsProblemAndNeverWrites` — the fake records no write after an update, and `file()` holds the update.
  - `load_badShape_setsProblem` — a table of texts, each with `problem()` set: `{}`, `{"items":[{"id":1}]}`, `[]`, `not json`.
  - `update_backToBack_appliesInOrder` — a second change reads the first change's item.
  - `update_changeThrows_rejectsAndKeepsFile` — the file and listeners are unchanged, and a later update applies.
  - `update_writeFails_resolvesAndLogs` — resolves to the new file, and the log holds `work.json not written: …`.
  - `update_listenerThrows_stillResolvesAndCallsOthers` — of two listeners the first throws; the second is called with the new file, the update resolves to it, and the log holds `work listener failed: …`.
  - `roundTrip_savedFile_parsesEqual` — a file holding one item, one card of each kind, a suggestion, a not-yet entry and both job statuses saves, then reads back equal through `parseWorkFile`.
  - `buildWorkState` table: a Jira card's column is derived, a local task keeps `Todo`, a local task in a column `work.columns` lacks shows `Other`, `columns` ends in `Other`, and `problem` passes through.
- `main/start.test.ts`, over the part harness (`src/shared/plugin-part-harness.test-support.ts`) with an in-memory data folder:
  - `start_emptySlot` — with no `work.json`, the slot holds no value before the load ends, then the empty state: no items, cards or suggestions, the five columns then `Other`, both job statuses null, `problem` null.
  - `start_problemPassesThrough` — with a `work.json` of `not json`, the slot's `problem` is the problem text, and after an update through the store the file's bytes are unchanged.
  - `start_settingsChangeRepublishes` — a stored Jira card with status `In Review` shows `In QA`; after `work.columns` changes to map `In Review` to `Done` and `onSettingsChanged` fires, it shows `Done`.
  - `start_disposeAwaitsSettled` — `dispose` does not resolve until a pending update's write resolves.
- `page/start.test.ts` › `command_invokesChannel` table: every one of the 12 commands, with its arg, invokes the channel method of the same name with that arg, and a rejecting invoke rejects the handler.

Done when: `npm run typecheck` and `npm run lint` pass, the test gate runs the tests above, and runtime checks defer to task 14 (Final verification).
Commit: one commit for the group.

## Proof

Commit 23d8904d9 · proof: diff read: manifest (12 commands, settings), contract (types, columnForStatus, ticketKeysIn, readColumns, readProjects, statusLine, workStateSlot, WorkChannel, 3 CommandKeys), store (parseWorkFile, buildWorkState, createWorkStore), main and page starts, registered after backlog; wave 1 typecheck + lint clean · concerns: hand formatting passed oxfmt; readColumns/readProjects carry as-string casts on an any entry; start_emptySlot and columnForStatus default rows read the manifest defaults
