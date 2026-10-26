# 03 — Shared page modules; forms adopts them

Status: not started
Type: Batch
Wave: 3 · Depends on: 02
Plan: [plan.md](plan.md)
Rules: [plan.md § Rules for every task](plan.md#rules-for-every-task)

Lift six page modules out of `src/plugins/forms/page/` into `src/shared/page/`, generic and with no forms name, and
make forms use them. Forms' behaviour does not change: every forms test keeps its meaning, and only names, imports
and call shapes move. The primer page (tasks 06 and 07) is the second user of each module.

Files:
- create `src/shared/page/reducer-store.ts`, `src/shared/page/reducer-store.test.ts`
- create `src/shared/page/autosave.ts`, `src/shared/page/autosave.test.ts`
- create `src/shared/page/editor-boxes.ts`, `src/shared/page/editor-boxes.test.ts`
- create `src/shared/page/key-hint.ts`
- create `src/shared/page/confirm-prompt.ts`
- create `src/shared/page/session-form-tabs.ts`
- modify `src/plugins/forms/page/form-state.ts`, `autosave.ts`, `boxes.ts`, `forms-commands.ts`, `forms-events.ts`,
  `forms-view.ts`, `round-view.ts`, `start.ts`, `view-model.ts`, `kinds/card-parts.ts`, `layout/card-kit.ts`,
  `layout/layout-panes.ts` (all under `src/plugins/forms/page/`)
- modify tests `src/plugins/forms/page/autosave.test.ts`, `boxes.test.ts`, `forms-commands.test.ts`,
  `forms-events.test.ts`, `form-state.test.ts`, `round-view.test.ts`, `view-model.test.ts`
- delete `src/plugins/forms/page/forms-store.ts`, `forms-store.test.ts`, `editor-boxes.ts`, `editor-boxes.test.ts`

Consumes:
- forms page `start.ts` as task 02 leaves it (it maps `formShown` / `formClosed` / `openForms` to forms' round names)
  ← 02
- `Timers` (`src/contracts/ambient.ts`), `Log` (`src/contracts/log.ts`), `EditorHost`, `FocusOptions`, `TextEditor`,
  `VimMode` (`src/contracts/editor.ts`), `CommandId` (`src/contracts/commands.ts`), `ViewScope`
  (`src/contracts/keymap.ts`), `Disposable` (`src/contracts/disposable.ts`), `Platform`
  (`src/contracts/platform.ts`), `PushedScope` (`src/contracts/plugin.ts`) — in the tree
- `errorText` (`src/shared/error-text.ts`), `element` (`src/shared/page/dom.ts`), `kbd`, `textButton`, `createDialog`,
  `emptyState` (`src/shared/page/ui/`) — in the tree

Produces:

`src/shared/page/reducer-store.ts`:
```ts
export interface ReducerStore<State, Action> {
  get(): State;
  // Applies the action; listeners run only when the state changed.
  dispatch(action: Action): void;
  // Listeners read `get()`, so a dispatch made inside one stays consistent.
  subscribe(listener: () => void): void;
}
export function createReducerStore<State, Action>(
  initial: State,
  apply: (state: State, action: Action) => State,
): ReducerStore<State, Action>;
```

`src/shared/page/autosave.ts`:
```ts
export type SaveState = 'saved' | 'saving' | 'unsaved';
// What autosave reads of one open form's state.
export interface DraftRevisions {
  // Counts body edits; a save carries the revision it sent.
  revision: number;
  savingRevision: number | null;
  savedRevision: number;
  // The last failed save's message; cleared when a save starts or succeeds.
  saveError: string | null;
}
export function saveState(draft: DraftRevisions): SaveState;
export function startSave<Draft extends DraftRevisions>(draft: Draft, revision: number): Draft;
// `error` is null for a save that succeeded.
export function finishSave<Draft extends DraftRevisions>(
  draft: Draft,
  revision: number,
  error: string | null,
): Draft;
export function saveLabel(state: SaveState, error: string | null): string;
export interface AutosaveDeps<Draft extends DraftRevisions, Body> {
  subscribe(listener: () => void): void;
  // The open drafts now, read after each change `subscribe` reports.
  drafts(): readonly Draft[];
  idOf(draft: Draft): string;
  bodyOf(draft: Draft): Body;
  // Each dispatches the caller's own save action for draft `id`.
  saveStarted(id: string, revision: number): void;
  saveFinished(id: string, revision: number, error: string | null): void;
  // Resolves once main has written the draft; rejects with main's error.
  save(id: string, body: Body): Promise<void>;
  // Read each time a save is scheduled.
  delayMs(): number;
  timers: Timers;
  log: Log;
  // The log line's source, the plugin id.
  logSource: string;
}
export function startAutosave<Draft extends DraftRevisions, Body>(
  deps: AutosaveDeps<Draft, Body>,
): void;
```

`src/shared/page/editor-boxes.ts`:
```ts
// How the boxes of one kind of form are told apart.
export interface BoxIdentity<Box> {
  // The form a box belongs to; `destroyForm` drops a form's boxes together.
  formIdOf(box: Box): string;
  // Unique among every mounted box.
  keyOf(box: Box): string;
  // How the log names the box, e.g. `notes on question 1`.
  describe(box: Box): string;
  // The log line's source, the plugin id.
  logSource: string;
}
export interface EditorBoxEvents<Box> {
  changed(box: Box, text: string): void;
  // A box took focus, from a command or a click.
  activated(box: Box): void;
}
export interface EditorBoxes<Box> {
  mount(parent: HTMLElement, box: Box, text: string): void;
  isMounted(box: Box): boolean;
  boxOf(editor: TextEditor): Box | undefined;
  focus(box: Box, options?: FocusOptions): void;
  leave(): void;
  active(): Box | null;
  activeMode(): VimMode | null;
  destroyBox(box: Box): void;
  destroyForm(formId: string): void;
  formIdOf(box: Box): string;
  onChange(listener: () => void): void;
}
export function createEditorBoxes<Box>(
  host: EditorHost,
  events: EditorBoxEvents<Box>,
  log: Log,
  identity: BoxIdentity<Box>,
): EditorBoxes<Box>;
export function keepFocusedBox<Box>(
  boxes: Pick<EditorBoxes<Box>, 'active' | 'activeMode' | 'focus' | 'isMounted' | 'formIdOf'>,
  formId: string,
  rebuild: () => void,
): void;
// The box `step` places away from `from` in `shown`, clamped at the ends; with no `from`, or one not in `shown`,
// the first box; null for an empty `shown`.
export function stepBox<Box>(
  shown: readonly Box[],
  keyOf: (box: Box) => string,
  from: Box | null,
  step: number,
): Box | null;
```

`src/shared/page/key-hint.ts`:
```ts
export function keyHint(keys: string | null, platform: Platform): HTMLElement | null;
export function appendKeyHint(
  control: HTMLElement,
  readKeys: () => string | null,
  platform: Platform,
): () => void;
```

`src/shared/page/confirm-prompt.ts`:
```ts
export interface ConfirmChoice {
  label: string;
  command: CommandId;
}
// The keys a button's hint reads; the `keys` plugin's page exports fit.
export interface ConfirmKeys {
  keysFor(command: CommandId, scope?: ViewScope): string | null;
  onChanged(listener: () => void): Disposable;
}
export interface ConfirmPromptDeps {
  title: string;
  body: string;
  // The safe choice, drawn first as a secondary button.
  keep: ConfirmChoice;
  // Drawn second as a danger button.
  confirm: ConfirmChoice;
  // The pushed scope, qualified, whose keys each button's hint shows.
  scope: ViewScope;
  keys: ConfirmKeys;
  run(command: CommandId): void;
  platform: Platform;
  // Lays the prompt's scope over the caller's base scope.
  pushScope(): PushedScope;
  // Whether the caller's state asks for the prompt now.
  isAsked(): boolean;
  // Whether the caller's form is sending; a dismiss the base scope owes waits until it is not.
  isSending(): boolean;
  // Asks the caller's state to drop the prompt.
  dismiss(): void;
  // Runs on each base scope change under the pushed scope.
  onBaseChanged(): void;
  log: Log;
  logSource: string;
}
export interface ConfirmPrompt {
  // The dialog's scrim, for the caller's overlay area.
  element: HTMLElement;
  // Call first on each render. Returns false when it dismissed a prompt whose dismiss waited on a send that has
  // ended; that dismiss renders again, so the caller stops its render.
  settleOwedDismiss(): boolean;
  // Call before the caller sets its base scope: hides the prompt and pops its scope once it is not asked.
  hideIfDone(): void;
  // Call after the caller sets its base scope: shows the prompt and pushes its scope once it is asked.
  showIfAsked(): void;
}
export function createConfirmPrompt(deps: ConfirmPromptDeps): ConfirmPrompt;
```

`src/shared/page/session-form-tabs.ts`:
```ts
// A tab added to a session; the sessions plugin's `SessionTabView` fits.
export interface FormTabView {
  id: string;
  title: string;
  element: HTMLElement;
  beforeClose(): boolean;
  shown(): void;
}
// The sessions plugin's `SessionTabHandle` fits.
export interface FormTabHandle {
  setStatus(status: string): void;
  select(): void;
  takeOver(): { release(): void };
  isVisible(): boolean;
}
export interface SessionFormTabsDeps {
  // The sessions plugin's page export `addTab` fits.
  addTab(sessionId: string, tab: FormTabView): FormTabHandle;
  tabId: string;
  title: string;
  // The tab element's class.
  className: string;
  // The idle state's line while the session has no open form.
  idleText: string;
  beforeClose(sessionId: string): boolean;
  // Runs each time one of these tabs becomes the visible tab.
  shown(): void;
}
export interface SessionFormTabs {
  // Puts a form's view root into the session's tab, before its idle state, adding the tab first when the
  // session has none.
  mount(sessionId: string, root: HTMLElement): void;
  // Takes over the session with its tab for form `formId`; `release` gives it back.
  takeOver(formId: string, sessionId: string): void;
  release(formId: string): void;
  // For each tab: shows its idle state while `statusOf` is null, and sends its status (`statusOf`, or '' for
  // null) to the session's row when it changed.
  sync(statusOf: (sessionId: string) => string | null): void;
  // Drops the session's tab entry once sessions dropped the tab.
  forget(sessionId: string): void;
  // Selects the session's tab; nothing when it has none.
  select(sessionId: string): void;
  // Whether one of these tabs is the visible tab now.
  isShown(): boolean;
}
export function createSessionFormTabs(deps: SessionFormTabsDeps): SessionFormTabs;
```

Forms-side names after this task (tasks 06 and 07 copy their shape; nothing outside forms imports them):
- `export type FormsStore = ReducerStore<FormsState, FormsAction>` in `src/plugins/forms/page/form-state.ts`
- `export const FORMS_BOX_IDENTITY: BoxIdentity<BoxRef>` in `src/plugins/forms/page/boxes.ts`
- `export function startRoundAutosave(deps: RoundAutosaveDeps): void` in `src/plugins/forms/page/autosave.ts`,
  where `RoundAutosaveDeps` is today's `AutosaveDeps` (`store`, `save`, `delayMs`, `timers`, `log`) renamed

Decisions:
- **Names.** No shared name holds `round`, `forms` or `primer` (plan.md § Boundary rules). `destroyRound` becomes
  `destroyForm`; the log source comes in through `logSource`, never as the literal `'forms'`.
- **Layer.** Every new module sits in the existing `src/shared/page` layer, which may import `src/contracts`,
  `src/shared` and `src/shared/page/ui` only. So the shared modules take the sessions and keys exports as the
  structural types above (`FormTabView`, `FormTabHandle`, `ConfirmKeys`), which the plugins' real exports satisfy.
  `scripts/check-layers.mts` does not change.
- **Reducer store.** The body of `createFormsStore` moves unchanged; `apply` becomes a parameter. `forms-store.ts`
  goes; its `FormsStore` type lives on as the alias in `form-state.ts`. Each `createFormsStore(x)` becomes
  `createReducerStore(x, apply)` (3 call sites outside `forms-store*.ts`: `start.ts`, `autosave.test.ts`,
  `forms-commands.test.ts`; measured at plan time, re-verify). Every `import ... from './forms-store'` (8 files
  besides `forms-store.test.ts`; measured at plan time, re-verify) imports from `./form-state` instead.
- **Autosave.** `startAutosave`'s loop moves unchanged, reading each draft through `drafts`, `idOf`, `bodyOf`,
  `saveStarted` and `saveFinished`. The log line keeps its text, `draft not saved for <id>: <message>`, under
  `logSource`. `SaveState`, `saveState`, `startSave` and `finishSave` move out of `form-state.ts`, and `saveLabel`
  with its `SAVE_LABELS` (`Saved`, `Saving…`, `Unsaved`, and `Unsaved — <error>`) out of `view-model.ts`, each
  generic over `DraftRevisions`. `RoundState` keeps its four revision fields, so it satisfies `DraftRevisions` as it
  is. Forms keeps `src/plugins/forms/page/autosave.ts` as a thin adapter, `startRoundAutosave`, which calls the
  shared `startAutosave` with `drafts: () => store.get().rounds`, `idOf: (round) => round.roundId`,
  `bodyOf: buildBody`, `logSource: 'forms'`, and `saveFinished` dispatching
  `{ type: 'saveFinished', roundId, revision, ok: true }` for a null `error`, else the `ok: false` form with the
  error. The adapter keeps forms' autosave test about forms' wiring; forms' `start.ts` calls it where it calls
  `startAutosave` today.
- **Editor boxes.** `createEditorBoxes`' body moves unchanged except that it keys, describes and groups through
  `identity`. `formIdOf` on the handle returns `identity.formIdOf(box)`, so `keepFocusedBox` (moved from
  `round-view.ts`) reads the focused box's form without knowing its shape. Forms' `BoxRef`, `boxKey` and
  `boxDescription` stay in `boxes.ts`, and `FORMS_BOX_IDENTITY` there is
  `{ formIdOf: (box) => box.roundId, keyOf: boxKey, describe: boxDescription, logSource: 'forms' }`. Forms names the
  handle `EditorBoxes<BoxRef>` wherever it names `EditorBoxes` today (`forms-commands.ts`, `forms-view.ts`,
  `round-view.ts`, `start.ts`). `RoundViewDeps.boxes` picks `'destroyForm'` in place of `'destroyRound'` and adds
  `'formIdOf'`.
- **stepBox.** Forms' `stepBox(state, from, step)` goes. Its one caller, `stepFocus` in `forms-commands.ts`, calls
  `stepBox(shownBoxes(state), boxKey, from, step)`, and `boxes.test.ts`' `stepBox` cases call the same form with the
  same expectations.
- **Key hints.** `keyHint` and `appendKeyHint` move from `kinds/card-parts.ts` unchanged. Their importers
  (`card-parts.ts` itself for `buildChoiceList`, `layout/card-kit.ts`, `layout/layout-panes.ts`, `forms-view.ts`)
  import from `src/shared/page/key-hint`. Chat's `keyHint` (`src/plugins/chat/page/key-hint.ts`), sessions'
  `noSelectionHint` and keys' `closeHelpHint` stay: they are the tracked follow-up in `docs/features/followups.md`
  (plan.md § Out of scope).
- **Confirm prompt.** `buildConfirm`, `pushConfirmScope`, `confirmScope` and `isDismissOwed` leave `forms-view.ts`
  for `createConfirmPrompt`, which keeps their logic step for step: the pushed scope's `onBaseChanged` runs
  `deps.onBaseChanged()`, then, while that pushed scope is current, `deps.dismiss()`; then it logs
  `cancel prompt dismissed: the view moved on` under `logSource` when `isAsked()` is false, or owes the dismiss when
  `isSending()` is true. `settleOwedDismiss` clears the owed dismiss when `isAsked()` is false; when one is owed and
  `isSending()` is false it clears it, runs `dismiss()`, logs the same line and returns false. Forms' render calls
  `settleOwedDismiss()` first (returning when false), `hideIfDone()` before `setScope`, and `showIfAsked()` after it,
  where the three blocks stand today. Forms passes: title `Cancel this round?`, body
  `The agent is told the round was cancelled. Your answers stay saved.`, keep
  `{ label: 'Keep answering', command: formsCommand('dismissConfirm') }`, confirm
  `{ label: 'Cancel round', command: formsCommand('confirmCancel') }`, scope `formsScope('confirm')`, `isAsked` as
  `view === 'confirm'`, `isSending` as `(activeRound(state)?.sending ?? null) !== null`, `dismiss` as
  `dispatch({ type: 'dismissConfirm' })`, `onBaseChanged` as its status line update, `logSource: 'forms'`.
- **Session form tabs.** `FormTab`, `formTabOf`, `syncFormTabs`, `isFormShown`, the `takeOvers` map and the
  `formTabs` map leave `forms-view.ts` for `createSessionFormTabs`. Forms passes `tabId: 'form'`, `title: 'Form'`,
  `className: 'form-tab'`, `idleText: "No round open. The agent's next round opens here."`, its `beforeClose`, and
  `shown: () => deps.setScope(deps.store.get().view)`. A round view's root goes in through `mount(round.sessionId,
  root)` in the attach callback `createRoundView` takes today, then `takeOver(round.roundId, round.sessionId)`;
  `destroyRoundView` calls `release(roundId)`; `syncFormTabs` becomes
  `sync((sessionId) => { const round = roundOfSession(state, sessionId); return round === undefined ? null : sessionTitle(round); })`;
  `showForm` calls `select`; `forgetSession` calls `forget` and then destroys the session's round views as today.
- **Tests move as fits.** `forms-store.test.ts` moves to `reducer-store.test.ts` over a counter reducer, the same
  three claims. `editor-boxes.test.ts` moves to the shared `editor-boxes.test.ts` over a test box
  `{ formId: string; key: string }` with an identity whose `describe` returns `key`, the same claims; the
  `keepFocusedBox` describe block moves there from `round-view.test.ts`, the same four claims. The `saveLabel`
  describe block moves from `view-model.test.ts` to `autosave.test.ts`, the same assertions. Forms' `autosave.test.ts`
  stays and calls `startRoundAutosave`; `form-state.test.ts` imports `saveState` from the shared module;
  `round-view.test.ts` builds its boxes with `createEditorBoxes(host, events, log, FORMS_BOX_IDENTITY)`.

GIVEN a reducer store WHEN an action returns the same state THEN no listener runs.
GIVEN a reducer store WHEN a listener dispatches THEN every listener reads the newest state.
GIVEN two mounted boxes of form `f1` and one of `f2` WHEN `destroyForm('f1')` runs THEN only `f2`'s editor survives
and no box is active.
GIVEN a focused box in insert mode WHEN `keepFocusedBox` rebuilds its form THEN the remounted box takes focus with
`{ insertAtEnd: true }`.
GIVEN forms with every change above WHEN the forms suite runs THEN every forms test passes with its assertions
unchanged.

Tests:
- `src/shared/page/reducer-store.test.ts` — `holds the state an action produced and tells its listeners`,
  `tells no one about an action that changes nothing`, `lets a listener dispatch and every listener read the newest
  state`: the forms-store cases over `apply = (count, step) => count + step` (a step of 0 changes nothing).
- `src/shared/page/editor-boxes.test.ts` — the ten cases of forms' `editor-boxes.test.ts` (measured at plan time,
  re-verify), the destroy case renamed `finds a box by its editor, and destroys only one form's editors`, and the four `keepFocusedBox` cases of `round-view.test.ts`. The log case
  expects `focused <key>`.
- `src/shared/page/autosave.test.ts` — `saveLabel` (the `startAutosave` loop stays covered by forms'
  `autosave.test.ts` through the adapter): `saveLabel('unsaved', 'disk full')` is `Unsaved — disk full`;
  `saveLabel('unsaved', null)` is `Unsaved`, `saveLabel('saving', null)` is `Saving…`, `saveLabel('saved', null)` is
  `Saved`.
- Forms tests stay in place with the import and call changes above.

Approach: none beyond Decisions; each move keeps its body.

Done when: `npm run typecheck` and `npm run lint` pass; `npm test -- src/shared/page src/plugins/forms` passes with
the tests above. The forms self-test run is task 14's (live check 3).
Commit: one commit for the group in wigley-ai-gui

## Proof
