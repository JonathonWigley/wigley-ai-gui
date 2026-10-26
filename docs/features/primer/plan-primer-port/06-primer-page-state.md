# 06 — Primer page state, commands and keys

Status: done
Type: Task
Wave: 4 · Depends on: 03, 05
Plan: [plan.md](plan.md)
Rules: [plan.md § Rules for every task](plan.md#rules-for-every-task)

The Primer tab's state, its store, its text boxes and its command handlers, and the primer's commands, scopes and
default keys. Task 07 draws the state and starts the page part; task 08 drives the commands by id. Model each piece
on its forms counterpart (`src/plugins/forms/page/form-state.ts`, `boxes.ts`, `forms-commands.ts`) as task 03 left
it; this document gives what differs.

Files:
- create `src/plugins/primer/page/ids.ts`
- create `src/plugins/primer/page/primer-state.ts`, test `src/plugins/primer/page/primer-state.test.ts`
- create `src/plugins/primer/page/primer-store.ts`
- create `src/plugins/primer/page/boxes.ts`, test `src/plugins/primer/page/boxes.test.ts`
- create `src/plugins/primer/page/primer-commands.ts`, test `src/plugins/primer/page/primer-commands.test.ts`
- create `src/plugins/primer/page/test-primers.ts` (test fixtures, as forms' `test-rounds.ts`)
- modify `src/plugins/primer/manifest.ts` (commands and scopes), `src/plugins/keymap.ts` (the Primer section)

Consumes:
- `primerManifest` in `src/plugins/primer/manifest.ts`, with `id: 'primer'`, `dependsOn: ['sessions', 'keys']`,
  settings `deadlineSeconds` and `autosaveDelayMs`, and no commands; and its entry in `builtInManifests` in
  `src/plugins/manifests.ts` ← 05
- `Primer`, `PrimerBody`, `PrimerEntry`, `PrimerFeature`, `PrimerItem`, `PrimerGroup`, `PrimerNeed`,
  `PresentedPrimer`, `PrimerView`, `PRIMER_SLUG_PATTERN`, `MAX_PRIMER_ENTRIES`, `MAX_PRIMER_ITEMS` in
  `src/plugins/primer/contract.ts` ← 05
- `AgentFormEnd<Body>`, `AgentFormEndKind`, `AgentFormClosed` in `src/contracts/agent-forms.ts` ← 02
- `ReducerStore`, `createReducerStore` (`src/shared/page/reducer-store.ts`); `DraftRevisions`, `startSave`,
  `finishSave` (`src/shared/page/autosave.ts`); `BoxIdentity`, `EditorBoxes`, `stepBox`
  (`src/shared/page/editor-boxes.ts`) ← 03
- `scrollText` (`src/shared/content-scroll.ts`), `errorText` (`src/shared/error-text.ts`), `qualify`
  (`src/shared/plugin-manifests.ts`), `PageStart`, `PageCommandContext`, `ToastTone` (`src/contracts/plugin.ts`),
  `ContentScroll`, `ScrollStep`, `FocusOptions` (`src/contracts/editor.ts`) — in the tree

Produces:

Commands in `primerManifest.commands` (`src/plugins/primer/manifest.ts`), every one `runsIn: 'page'`, as
`<id>: label · group`:

| Command id | Label | Group |
| --- | --- | --- |
| `primer.nextRow` | next row | rows |
| `primer.prevRow` | previous row | rows |
| `primer.needYes` | needed | need |
| `primer.needNo` | not needed | need |
| `primer.needUnclear` | unclear | need |
| `primer.addExtraTask` | add an extra task | tasks |
| `primer.removeExtraTask` | remove the extra task | tasks |
| `primer.focusCard` | focus the card | panes |
| `primer.focusRail` | focus the rail | panes |
| `primer.nextItem` | next item | items |
| `primer.prevItem` | previous item | items |
| `primer.toggleInclude` | include the item | items |
| `primer.addItem` | add an item | items |
| `primer.editItemComment` | item comment box | boxes |
| `primer.editTaskComment` | task comment box | boxes |
| `primer.editFirstField` | first box | boxes |
| `primer.nextBox` | next box | boxes |
| `primer.prevBox` | previous box | boxes |
| `primer.leaveBox` | leave the box | boxes |
| `primer.lineDown` | scroll a line down | view |
| `primer.lineUp` | scroll a line up | view |
| `primer.halfPageDown` | scroll half a page down | view |
| `primer.halfPageUp` | scroll half a page up | view |
| `primer.openReview` | review | review |
| `primer.closeReview` | back to the primer | review |
| `primer.submit` | send the primer | review |
| `primer.askCancel` | cancel the primer | review |
| `primer.confirmCancel` | yes, cancel the primer | confirm |
| `primer.dismissConfirm` | keep the primer | confirm |

Scopes in `primerManifest.scopes`: `rail: 'In the primer rail'`, `card: 'In the primer card'`,
`review: 'In the primer review'`, `confirm: 'In the primer cancel confirmation'`, `idle: 'With no primer open'`.

`src/plugins/primer/page/ids.ts`:
```ts
export type PrimerCommandName = keyof typeof primerManifest.commands;
export type PrimerScopeName = keyof typeof primerManifest.scopes & string;
export function primerCommand(short: PrimerCommandName): CommandId;
export function primerScope(short: PrimerScopeName): ViewScope;
```

`src/plugins/primer/page/primer-state.ts`:
```ts
export type PrimerPane = 'rail' | 'card';
export type FeatureField = 'name' | 'slug' | 'spec' | 'summary' | 'notes';
// `item` is 1-based within the task's items.
export type TextTarget =
  | { field: 'feature'; name: FeatureField }
  | { field: 'taskName'; entryId: string }
  | { field: 'itemComment'; entryId: string; item: number }
  | { field: 'newItem'; entryId: string }
  | { field: 'taskComment'; entryId: string };
export type RailRow = { kind: 'feature' } | { kind: 'task'; entryId: string };
// A finish handed to main and not yet answered by it; `closesSession` marks a cancel the close prompt asked.
export interface PrimerSend { kind: AgentFormEndKind; closesSession: boolean }
export interface OpenPrimer extends DraftRevisions {
  primerId: string;
  sessionId: string;
  label: string;
  // As the agent sent it.
  primer: Primer;
  // As the user edited it: the sent tasks in sent order, then the extra tasks in the order added.
  feature: PrimerFeature;
  entries: PrimerEntry[];
  // A position in railRows(primer).
  railCursor: number;
  // A position in the selected task's items.
  itemCursor: number;
  pane: PrimerPane;
  // Each add-item box's text, by entry id; not part of the body.
  newItemTexts: Readonly<Record<string, string>>;
  sending: PrimerSend | null;
}
export interface PrimerState {
  // In the order they were shown.
  primers: OpenPrimer[];
  activePrimerId: string | null;
  activeSessionId: string | null;
  view: PrimerView;
  confirmReturnView: 'primer' | 'review';
  confirmClosesSession: boolean;
}
export type PrimerAction =
  | { type: 'primerShown'; primer: PresentedPrimer }
  | { type: 'primerClosed'; primerId: string }
  | { type: 'sessionActivated'; sessionId: string | null }
  | { type: 'askClose'; sessionId: string }
  | { type: 'nextRow' }
  | { type: 'prevRow' }
  | { type: 'selectRow'; row: number }
  | { type: 'setNeed'; need: PrimerNeed }
  | { type: 'addExtraTask' }
  | { type: 'removeExtraTask' }
  | { type: 'focusPane'; pane: PrimerPane }
  | { type: 'nextItem' }
  | { type: 'prevItem' }
  | { type: 'selectItem'; item: number }
  | { type: 'toggleInclude' }
  | { type: 'addItem'; primerId: string; entryId: string }
  | { type: 'showTarget'; primerId: string; target: TextTarget }
  | { type: 'setText'; primerId: string; target: TextTarget; value: string }
  | { type: 'openReview' }
  | { type: 'closeReview' }
  | { type: 'askCancel' }
  | { type: 'dismissConfirm' }
  | { type: 'sendStarted'; primerId: string; kind: AgentFormEndKind }
  | { type: 'sendFailed'; primerId: string }
  | { type: 'saveStarted'; primerId: string; revision: number }
  | { type: 'saveFinished'; primerId: string; revision: number; error: string | null };
export function initialState(primers: PresentedPrimer[], activeSessionId: string | null): PrimerState;
// Returns `state` itself when the action changes nothing.
export function apply(state: PrimerState, action: PrimerAction): PrimerState;
export function activePrimer(state: PrimerState): OpenPrimer | null;
export function primerOfSession(state: PrimerState, sessionId: string | null): OpenPrimer | undefined;
export function railRows(primer: OpenPrimer): RailRow[];
export function selectedRow(primer: OpenPrimer): RailRow;
// The selected row's task, null on the Feature row.
export function selectedEntry(primer: OpenPrimer): PrimerEntry | null;
export function includedCount(entry: PrimerEntry): number;
export function buildBody(primer: OpenPrimer): PrimerBody;
// What blocks a submit, in this order; empty when it may send.
export function submitProblems(primer: OpenPrimer): string[];
// The session row's status for the Primer tab.
export function sessionTitle(primer: OpenPrimer): string;
// The scope the Primer tab's keys fire in for this state.
export function scopeOf(state: PrimerState): PrimerScopeName;
// How the log names a rail row: `the feature` or `task <entryId>`.
export function rowName(row: RailRow): string;
```

`src/plugins/primer/page/primer-store.ts`:
```ts
export type PrimerStore = ReducerStore<PrimerState, PrimerAction>;
export function createPrimerStore(initial: PrimerState): PrimerStore;
```

`src/plugins/primer/page/boxes.ts`:
```ts
export interface PrimerBox { primerId: string; target: TextTarget }
export function boxKey(box: PrimerBox): string;
export function boxDescription(box: PrimerBox): string;
export const PRIMER_BOX_IDENTITY: BoxIdentity<PrimerBox>;
// The boxes the user can reach now, in Ctrl+n order.
export function shownBoxes(state: PrimerState): PrimerBox[];
// The text a box mounts with.
export function boxText(primer: OpenPrimer, target: TextTarget): string;
export function focusActionFor(state: PrimerState, box: PrimerBox): PrimerAction | null;
```

`src/plugins/primer/page/primer-commands.ts`:
```ts
export interface PrimerCommandDeps {
  store: PrimerStore;
  boxes: Pick<EditorBoxes<PrimerBox>, 'focus' | 'leave' | 'active' | 'boxOf'>;
  // Hands the finished primer to main; rejects with the reason when main keeps it open.
  finish(primerId: string, end: AgentFormEnd<PrimerBody>): Promise<void>;
  closeSession(sessionId: string): void;
  // Scrolls the active primer's card or review by `step`; null when no primer is shown.
  scrollPrimer(step: ScrollStep, direction: 1 | -1): ContentScroll | null;
  toast(text: string, tone: ToastTone): void;
  log: Log;
}
export function primerCommandHandlers(deps: PrimerCommandDeps): PageStart<typeof primerManifest>['commands'];
export interface GuardCloseDeps extends Pick<PrimerCommandDeps, 'store' | 'toast' | 'log'> {
  showPrimer(sessionId: string): void;
  activate(sessionId: string): void;
}
export function guardClose(deps: GuardCloseDeps, sessionId: string): boolean;
export type ClosePrimerFromMainDeps = Pick<PrimerCommandDeps, 'store' | 'closeSession' | 'toast' | 'log'>;
export function closePrimerFromMain(deps: ClosePrimerFromMainDeps, closed: AgentFormClosed): void;
```

The binds in `src/plugins/keymap.ts`, a `// ── Primer ──` banner section right after the Forms section, in this order
(`where` only where written):

| Keys | Scope | Command |
| --- | --- | --- |
| `j`, `<C-l>` | `primer.rail` | `primer.nextRow` |
| `k`, `<C-h>` | `primer.rail` | `primer.prevRow` |
| `y` / `n` / `u` | `primer.rail` | `primer.needYes` / `primer.needNo` / `primer.needUnclear` |
| `A` | `primer.rail` | `primer.addExtraTask` |
| `D` | `primer.rail` | `primer.removeExtraTask` |
| `<A-l>` | `primer.rail` | `primer.focusCard` |
| `<Leader><Leader>` (`where: 'page'`) | `primer.rail` | `primer.openReview` |
| `j` / `k` | `primer.card` | `primer.nextItem` / `primer.prevItem` |
| `x` | `primer.card` | `primer.toggleInclude` |
| `c` | `primer.card` | `primer.editItemComment` |
| `C` | `primer.card` | `primer.editTaskComment` |
| `a` | `primer.card` | `primer.addItem` |
| `i` | `primer.card` | `primer.editFirstField` |
| `<A-h>` | `primer.card` | `primer.focusRail` |
| `<C-n>` / `<C-p>` | `primer.card` | `primer.nextBox` / `primer.prevBox` |
| `<C-j>` / `<C-k>` | `primer.card` | `primer.lineDown` / `primer.lineUp` |
| `<C-S-j>` / `<C-S-k>` | `primer.card` | `primer.halfPageDown` / `primer.halfPageUp` |
| `<Leader><Leader>` (`where: 'both'`) | `primer.card` | `primer.openReview` |
| `<Esc>` (`where: 'box'`) | `primer.card` | `primer.leaveBox` |
| `<D-Enter>` | `primer.review` | `primer.submit` |
| `<Esc>` | `primer.review` | `primer.closeReview` |
| `C` | `primer.review` | `primer.askCancel` |
| `<C-j>` / `<C-k>` | `primer.review` | `primer.lineDown` / `primer.lineUp` |
| `<C-S-j>` / `<C-S-k>` | `primer.review` | `primer.halfPageDown` / `primer.halfPageUp` |
| `y` | `primer.confirm` | `primer.confirmCancel` |
| `n`, `<Esc>` | `primer.confirm` | `primer.dismissConfirm` |

`primer.idle` takes no bind, as `forms.idle` takes none.

Decisions:
- **Keys follow `docs/features/primer/design.md` § Keys row for row.** Checked against `docs/keymap.md`: `j`/`k` and
  `<C-l>`/`<C-h>` move (Layers: raw key, Ctrl+hjkl next and previous unit), `y`/`n` confirm, Shift is the bigger
  variant (`A` beside `a`), `<A-l>`/`<A-h>` move between panes exactly as docs binds `<A-l>` in `docs.tree` and
  `<A-h>` in `docs.doc`, `<C-n>`/`<C-p>` move between boxes, `<C-j>`…`<C-S-k>` scroll, `<D-Enter>` submits, and
  `<Leader><Leader>` is the context's overview (Leader groups table). Checked against forms' binds: no primer scope
  overlaps a forms scope, and no primer box bind's keys begin another box bind's longer keys. The box binds live in
  `primer.card`, the scope in force while a box has focus (a focused box sets the pane to `card`). A chord bound in
  `primer.card` fires inside a box too, so `<C-n>`, `<C-p>`, the scroll chords and `<A-h>` work there with no box
  entry.
- **Command ids** are the names above; task 08 drives them, and `docs/features/primer/design.md` § Keys names their
  actions. The page part (task 07) registers their handlers; until task 07 lands, the app's startup key check finds
  the binds without handlers, so nothing runs the app between this task and task 07.
- **Rail order.** `railRows` is the Feature row, then the tasks of group `primer`, then `standing`, then `extra`,
  each group in `entries` order. `railCursor` indexes it.
- **Restoring a primer.** `primerShown` is a no-op for a `formId` already held. A new `OpenPrimer` takes `feature`
  and `entries` from `primer.draft` when it is not null, else from `primer.form`; `railCursor` 0, `itemCursor` 0,
  `pane` `'rail'`, `newItemTexts` `{}`, revisions 0, `savingRevision` null, `saveError` null, `sending` null. A
  primer for the active session becomes active with `view: 'primer'`; one for another session waits, as forms'
  `showRound` does. `sessionActivated`, `primerClosed`, `askClose`, `askCancel` and `dismissConfirm` follow forms'
  `activateSession`, `closeRound`, `askClose` and the two cases in forms' `apply`, with `'primer'` in place of
  `'forms'`.
- **View guards.** Row actions (`nextRow`, `prevRow`, `selectRow`, `setNeed`, `addExtraTask`, `removeExtraTask`),
  `focusPane`, item actions (`nextItem`, `prevItem`, `selectItem`, `toggleInclude`), `showTarget` and `openReview`
  apply only in view `'primer'`. Item actions change nothing on the Feature row. While the active primer is sending,
  only `primerShown`, `primerClosed`, `sessionActivated`, `setText`, `saveStarted`, `saveFinished` and `sendFailed`
  apply (forms' `SENDING_ACTIONS`).
- **Moves clamp.** `nextRow` / `prevRow` / `nextItem` / `prevItem` step by one and clamp at the ends, as forms'
  `moveFocus` does. A row change sets `itemCursor` to 0.
- **Revision.** `revision` counts body edits and grows by one on each that changes the body: `setText` on any
  target but `newItem`, `setNeed`, `toggleInclude`, `addItem`, `addExtraTask`, `removeExtraTask`. `newItem` text and
  every cursor, pane and view change leave it. `saveStarted` and `saveFinished` apply the shared `startSave` and
  `finishSave`.
- **Extra tasks.** `addExtraTask` appends `{ id: 'extra-<n>', group: 'extra', number: null, area: '', question: '',
  task: '', need: 'yes', evidence: '', probes: '', pointer: '', comment: '', items: [] }`, where `n` is the smallest
  whole number from 1 with no entry of that id; it selects the new row, sets `pane` `'card'`, and changes nothing
  when `entries` already holds `MAX_PRIMER_ENTRIES` (60). `removeExtraTask` removes the selected task only when its
  `group` is `'extra'`, drops its `newItemTexts` entry, and keeps `railCursor` at its position, clamped to the last
  row.
- **Items.** `toggleInclude` flips `include` on the item at `itemCursor`. `addItem` takes
  `newItemTexts[entryId]` trimmed; when it is not blank and the task holds fewer than `MAX_PRIMER_ITEMS` (20) items,
  it appends `{ text, include: true, comment: '', added: true }`, clears that entry's text to `''` and, on the
  selected task, moves `itemCursor` to the new item. It applies in any view, since a box may leave on a key that
  opens the review. Added items are never removed; the user leaves one out with `x`.
- **showTarget** selects the target's row (`feature` targets row 0, the rest their entry's row), sets `itemCursor`
  to `item - 1` for `itemComment`, and sets `pane` `'card'`. `focusActionFor` returns it for a box of the active
  primer in view `'primer'`, else null.
- **Submit problems**, verbatim, in this order: `The slug must be lowercase letters, digits and dashes, starting
  with a letter or digit.` when `feature.slug` fails `PRIMER_SLUG_PATTERN`; then one
  `Extra task <n> needs a name.` per extra task whose `task` is blank after trim, `n` its 1-based place among the
  extra tasks.
- **sessionTitle** is `` `${feature.name} ${decided}/${total}` ``: `decided` counts entries whose `need` is not
  `'unclear'`, `total` counts every entry. It plays the part of forms' `heading answered/total`.
- **scopeOf**: view `'primer'` gives the active primer's `pane` (`'rail'` or `'card'`); `'review'`, `'confirm'` and
  `'idle'` give themselves.
- **Box keys and descriptions**, verbatim (`<p>` the primer id, `<e>` the entry id, `<n>` the item number):

  | Target | `boxKey` | `boxDescription` |
  | --- | --- | --- |
  | feature `name` / `slug` / `spec` / `summary` | `<p>/feature/<name>` | `name of the feature` (and `slug of`, `spec of`, `summary of`) |
  | feature `notes` | `<p>/feature/notes` | `notes on the feature` |
  | `taskName` | `<p>/task/<e>/name` | `name of task <e>` |
  | `itemComment` | `<p>/task/<e>/item/<n>/comment` | `comment on item <n> of task <e>` |
  | `newItem` | `<p>/task/<e>/new-item` | `new item on task <e>` |
  | `taskComment` | `<p>/task/<e>/comment` | `comment on task <e>` |

  `PRIMER_BOX_IDENTITY` is `{ formIdOf: (box) => box.primerId, keyOf: boxKey, describe: boxDescription,
  logSource: 'primer' }`.
- **Shown boxes** (Ctrl+n order). View `'primer'`: on the Feature row, the five feature fields in the order
  `name`, `slug`, `spec`, `summary`, `notes`; on a task row, `taskName` (extra tasks only), one `itemComment` per item
  in order, `newItem`, then `taskComment`. Every other view shows no box; the review binds no box keys.
- **Focus options.** Every command that focuses a box passes `{ insertAtEnd: true }`, as forms' `editNotes` does
  (vim's `A`), except `nextBox` / `prevBox`, which pass none, as forms' `stepFocus` does.
- **The add-item box commits on a key that leaves it.** Before `leaveBox`, `nextBox`, `prevBox`, `openReview` and
  `focusRail` act, when the command's box (`boxIn`, as in forms) is a `newItem` box, the handler dispatches
  `addItem` for it and logs the result (below). A mouse click elsewhere commits nothing: the text stays in
  `newItemTexts` and the box shows it again. A store listener does not commit, because a box destroyed inside a
  render would dispatch inside that render.
- **Handlers**, each logging under source `primer` with the line given (`<e>` the entry id, `<n>` the 1-based item
  number). A command fired in a box first dispatches that box's `focusActionFor`, as forms' `focusBoxItem` does.
  - `nextRow` / `prevRow`: dispatch; when `railCursor` moved, `selected <rowName>`.
  - `needYes` / `needNo` / `needUnclear`: on the Feature row, `no task selected`; else dispatch `setNeed`, and when
    the need changed, `need <yes|no|unclear> on task <e>`.
  - `addExtraTask`: at 60 tasks, `no task added: the primer holds 60 tasks`; else dispatch, log
    `added extra task <e>`, and focus the new task's `taskName` box.
  - `removeExtraTask`: on a row that is not an extra task, `only an extra task can be removed`; else dispatch and
    log `removed extra task <e>`.
  - `focusCard`: dispatch `focusPane` `'card'`; when it changed, `focused the card`. `focusRail`: commit a `newItem`
    box, leave any box, dispatch `focusPane` `'rail'`; when it changed, `focused the rail`.
  - `nextItem` / `prevItem`: dispatch; when `itemCursor` moved, `selected item <n> on task <e>`.
  - `toggleInclude`: with no item at the cursor (the Feature row, or a task with no items), `no item selected`;
    else dispatch and log `included item <n> on task <e>` or `left out item <n> on task <e>`.
  - `editItemComment`: with no item at the cursor, `no item selected`; else focus that item's `itemComment` box.
  - `editTaskComment`: on the Feature row, `no task selected`; else focus the `taskComment` box.
  - `addItem`: on the Feature row, `no task selected`; at 20 items, `no item added: task <e> holds 20 items`; else
    focus the `newItem` box.
  - `editFirstField`: focus `shownBoxes(state)[0]`; with none, `no box to focus`.
  - `nextBox` / `prevBox`: commit a `newItem` box, then focus
    `stepBox(shownBoxes(state), boxKey, boxIn ?? null, ±1)`; with none, `no box to focus`.
  - `leaveBox`: commit a `newItem` box, `boxes.leave()`, `left the box`.
  - the four scroll commands: `scrollText('the primer', step, direction, scroll)`, or `no primer to scroll` when
    `scrollPrimer` returns null.
  - `openReview`: commit a `newItem` box, dispatch; when the view became `'review'`, `review opened`.
  - `closeReview`: dispatch; when the view became `'primer'`, `review closed`.
  - `submit`: only in view `'review'`, with an active primer not sending; when `submitProblems` is not empty,
    `submit refused: <the problems joined by one space>` and nothing sends; else finish as below with `'submitted'`.
  - `askCancel`, `dismissConfirm`: dispatch only. `confirmCancel`: only in view `'confirm'`, finish with
    `'cancelled'`.
  - a commit of a `newItem` box: when an item was added, `added item <n> on task <e>`; when the text was not blank
    and the task held 20 items, `no item added: task <e> holds 20 items`; nothing for blank text.
- **Finish** follows forms' `finishActiveRound`: dispatch `sendStarted`, call `finish(primerId, { kind, body:
  buildBody(primer) })`; on rejection dispatch `sendFailed`, log `primer <primerId> not finished: <error>`, toast
  `Primer not sent: <error>` with tone `error`.
- **closePrimerFromMain** follows forms' `closeRoundFromMain` with `closed.formId` as the primer id: on a close
  `byFinish` it logs the send's kind alone (`submitted` or `cancelled`) and toasts `Primer sent: <label>` (tone
  `success`) or `Primer cancelled: <label>` (tone `info`).
- **guardClose** follows forms' `guardClose` with these texts: log `session close kept: <label> is sending`, toast
  `Sending <label>'s primer…` (tone `info`); log `session close kept: <label> is open in the background`, toast
  `Finish or cancel <label>'s primer first` (tone `info`); log `closing the session asks to cancel <label>`.

GIVEN a presented primer with a draft WHEN `primerShown` applies THEN the open primer takes the draft's feature and
entries, and a second `primerShown` of the same `formId` returns the same state.
GIVEN the Feature row selected WHEN `setNeed` applies THEN the state is unchanged.
GIVEN a task with `need: 'unclear'` selected WHEN `setNeed` `'yes'` applies THEN its need is `'yes'` and `revision`
grew by one.
GIVEN an add-item text `'  Write the store '` WHEN `addItem` applies THEN the task ends with
`{ text: 'Write the store', include: true, comment: '', added: true }` and the text is `''`.
GIVEN 60 entries WHEN `addExtraTask` applies THEN the state is unchanged.
GIVEN entries `extra-1` and `extra-3` WHEN `addExtraTask` applies THEN the new entry's id is `extra-2`.
GIVEN slug `Bad Slug` and one unnamed extra task WHEN `submitProblems` runs THEN it returns the slug line, then
`Extra task 1 needs a name.`
GIVEN view `'review'` and a problem WHEN `submit` runs THEN `finish` is not called and the log reads
`submit refused: …`.
GIVEN the `newItem` box focused with text WHEN `nextBox` runs THEN the item is added, `added item <n> on task <e>` is
logged, and the `taskComment` box takes focus.

Tests:
- `primer-state.test.ts` — one case per GIVEN above on the reducer and helpers, plus: `railRows` orders feature,
  primer, standing, extra; `nextRow` clamps at both ends and resets `itemCursor`; `removeExtraTask` refuses a
  `standing` task and clamps the cursor after the last row; `toggleInclude` on the Feature row changes nothing;
  `setText` on `newItem` leaves `revision`; actions other than `SENDING` ones change nothing while sending;
  `sessionTitle` of a primer named `Primer port` with needs `yes`, `no`, `unclear` is `Primer port 2/3`; `scopeOf`
  gives `card` for view `'primer'` with pane `'card'`.
- `boxes.test.ts` — `shownBoxes` on the Feature row gives the five fields in order; on an extra task with two items,
  `taskName`, two `itemComment`, `newItem`, `taskComment`; in view `'review'`, none. `boxKey` and `boxDescription`
  give the table's strings for one target of each field.
- `primer-commands.test.ts` — over a fake `boxes` and a held `finish`, as `forms-commands.test.ts` builds them: the
  log line of each handler above for one changed and one unchanged case; `submit` with problems; `submit` resolving,
  then `closePrimerFromMain` byFinish toasting `Primer sent: <label>`; a rejected finish toasting
  `Primer not sent: disk full`; `guardClose` for a sending, a background and an active primer; the `newItem` commit
  on `nextBox` and on `leaveBox`.
- `src/plugins/keymap.test.ts` (existing, unchanged) — `defaultKeymap_MergedWithBuiltIns_PassesKeymapChecks` now
  covers the primer binds.

Approach: build the fixtures in `test-primers.ts` from `Primer` and `PresentedPrimer` literals (a feature
`{ name: 'Primer port', slug: 'primer-port', spec: '', summary: '', notes: '' }` and three entries, one per group
`primer`, `standing`, `extra`), as forms' `test-rounds.ts` builds `presentedRound`.

Done when: `npm run typecheck` and `npm run lint` pass; `npm test -- src/plugins/primer/page src/plugins/keymap.test.ts`
passes with the tests above. Driving the keys is task 08's; the live pass is task 14's.
Commit: one commit for the group in wigley-ai-gui

## Proof

Commit c439c93 · proof: diff read: ids, primer-state, primer-store, boxes, primer-commands exports present as planned; 29 commands and five scopes in the manifest; keymap Primer section; typecheck passes; worker ran lint and 61 tests over primer page and keymap · concerns: add-item commit clears newItemTexts but the mounted editor keeps its text unless 07 reacts; addExtraTask focuses the new taskName box synchronously, so 07 must mount the new card's boxes in its store listener; boxText throws on a stale task or item; ids.ts sits in page/ (forms and chat keep theirs at the plugin root)
