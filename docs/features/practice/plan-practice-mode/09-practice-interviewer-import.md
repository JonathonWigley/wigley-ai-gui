# 09 — Practice page: interviewer pane and import box

Status: in progress
Type: Task
Wave: 6 · Depends on: 03, 08
Plan: [plan.md](plan.md)

Files:     create `src/plugins/practice/page/interviewer-pane.ts` · create `src/plugins/practice/page/import-box.ts` ·
           modify `src/plugins/practice/manifest.ts` · modify `src/plugins/keymap.ts` ·
           modify `src/plugins/practice/layouts/layout.d.ts` · modify `src/plugins/practice/layouts/default/layout.js` ·
           modify `src/plugins/practice/layouts/default/layout.css` · modify `src/plugins/practice/page/layout/practice-kit.ts` ·
           modify `src/plugins/practice/page/practice-view.ts` · modify `src/plugins/practice/page/start.ts` ·
           modify `src/plugins/practice/page/layout/read-layout.ts` (the parts record gains `askBox`, `importBox`) ·
           modify `src/plugins/practice/page/practice.css` (the pane body and the ask frame, app-drawn) · modify
           `docs/keymap.md` ·
           test `src/plugins/practice/page/interviewer-pane.test.ts` · test `src/plugins/practice/page/import-box.test.ts`

Consumes:  `ChatPageExports.mountChat(element: HTMLElement, sessionId: string): ChatMount` and
           `interface ChatMount extends Disposable { shown(): void; hidden(): void }` ← 03 (through
           `api.dependency(chatPageKey)`). `mountChat` mounts empty when the session's `chat.session` key or row has
           not reached the page yet, and attaches when both arrive (03).
           PracticeChannel invoke `askInterviewer(slug, text): string`, `interviewerOf(slug): string | null`,
           `startImport(request: string): string` ← 05/06
           `ProblemWorkspace.sidePane: HTMLElement`, `ProblemWorkspace.setSidePaneShown(isShown: boolean)`,
           `ProblemWorkspace.sideResizeTarget: ResizeTarget` (the row split, `interviewerWidth`) ← 08
           `PracticeView.focusColumn(): void` (gives the column its keys back) ← 08
           `applyOpened(problem: OpenedProblem)` in `page/practice-view.ts`, the one place the view applies an `open` result ← 08
           `PracticeFocus` (with `'interviewer'`) and `PracticeView.setFocus(focus: PracticeFocus)` ← 07
           `ListKit.importHint(parent)`, the empty `span.practice-import-hint` slot in the list's key strip ← 07
           The list scope `practice.list` and the scopes that 08 binds Run (`<D-'>`) and Submit (`<D-Enter>`) in,
           in `src/plugins/keymap.ts` ← 07
           The practice layout contract (`layouts/layout.d.ts`), its part root type and `PracticeKit` ← 07
           `createDialog` (`src/shared/page/ui/dialog.ts`), `textBoxInput` (`src/shared/page/text-box.ts`),
           `inputFrame` (`src/shared/page/ui/input-frame.ts`); precedent `src/plugins/sessions/page/rename-dialog.ts`
           `EditorHost.create` (`src/contracts/editor.ts`), `api.panes.setOuterPanes` (`src/contracts/plugin.ts`
           `panes`, `OuterPanes` in `src/contracts/panes.ts`)

Produces:  `createInterviewerPane(deps: InterviewerPaneDeps): InterviewerPane` in `page/interviewer-pane.ts`:
           `interface InterviewerPane extends Disposable { element: HTMLElement; isShown(): boolean; toggle(): void;
           problemOpened(slug: string, attemptId: string): void; send(): void; leaveBox(): void; columnTookKeys(): void;
           modeHidden(): void; outerPanes: OuterPanes; redraw(): void }`
           `createImportBox(deps: ImportBoxDeps): ImportBox` in `page/import-box.ts`:
           `interface ImportBox { element: HTMLElement; open(): void; isOpen(): boolean; accept(): void;
           cancel(): void; redraw(): void }`
           Manifest commands (all `runsIn: 'page'`): `toggleInterviewer`, `askSend`, `askLeave`, `importStart`,
           `importAccept`, `importCancel`. Manifest scopes: `ask: 'In the interviewer ask box'`,
           `import: 'In the import box'`.
           Layout parts `askBox(parent, input: AskBoxInput, kit: AskBoxKit)` and
           `importBox(parent, input: ImportBoxInput, kit: ImportBoxKit)`, each returning the contract's part root.

Decisions:
- **The slot**: the pane fills 08's `workspace.sidePane` with `pane.element`. It builds no divider: 08's row split
  `side` (`sizedPane: 'end'`, uiState key `interviewerWidth`) is the divider, and `workspace.sideResizeTarget` is its
  resize target. The pane shows and hides the slot through `workspace.setSidePaneShown(isShown)`; nothing else
  calls it. While the slot is hidden its handle has no layout box, so `nudge` returns false.
- The pane starts hidden on each page load. Its open state is not saved. (design.md § The mode: "hidden until
  toggled".)
- `toggleInterviewer` with Practice not shown shows Practice, then opens the pane. With no open problem, it opens
  nothing, toasts `Open a problem first` (tone `info`) and logs `interviewer needs an open problem`. Hiding the pane
  while it holds the keys calls `view.focusColumn()` first.
- **The mount is keyed on the pair (slug, attempt id).** `problemOpened(slug, attemptId)` runs from 08's
  `applyOpened` for every applied `open` result: the user's open, a place restore, a `changed` refresh and the
  post-Submit refresh. When the pair equals the pair the pane last drew, it does nothing: the mount, the ask box and
  its typed text stay. When the pair differs (another problem, or a due problem's fresh attempt, design.md §
  Progress), it disposes the mount, destroys the ask box and, while the pane is shown, asks `interviewerOf(slug)`.
- The pane asks `interviewerOf(slug)` each time it opens and each time the pair changes while it is shown. A session
  id mounts chat's view with `mountChat(body, id)` at once. `null` draws the ask box. Each answer carries the pair it
  asked for. An answer for a pair that is no longer open is dropped.
- `send()` mounts with `mountChat(body, id)` as soon as `askInterviewer` resolves. `mountChat` mounts empty when the
  session's `chat.session` key or row has not reached the page yet, and attaches when both arrive (03), so the pane
  waits on no slot. The pane keeps the keys across the swap: the new mount gets `shown()` at once.
- Opening the pane gives it the keys: the ask box is focused with `{ insertAtEnd: true }`, or the mount gets
  `shown()`. A problem opened while the pane shows does not move the keys into the pane.
- `ChatMount.shown()` is called only when the pane takes the keys. `hidden()` is called when the pane gives them up:
  the column takes the keys, the pane hides, Practice hides, or before `dispose`. A chat view in an unfocused place
  holds no keys, as in Sessions mode (AGENTS.md § A chat pane).
- Focus enters a mounted chat view at its transcript, as the Chat tab's `shown` does. Chat's own `i` moves to its
  box. The ask box is the pane's one focus spot when no session is mounted.
- **Taking the keys**: the pane calls `view.setFocus('interviewer')`. 07's render then sets no scope and no targets.
  The pane sets them itself: scope `practice.ask`, `setFocusTarget(null)` and
  `setResizeTarget(workspace.sideResizeTarget)` when the ask box shows; or the mount's `shown()`, which sets chat's
  scope, when a session is mounted. Then it logs `interviewer focused`.
- **Giving up the keys**: the column holds the keys while `PracticeState.focus` is anything other than
  `'interviewer'`. 09 adds one line to 07's `setFocus`: when focus changes from `'interviewer'` to another value, it
  calls `pane.columnTookKeys()`, which calls the mount's `hidden()` once and logs `interviewer left`. A second call
  while the pane does not hold the keys does nothing.
- **Alt+h and Alt+l**: while Practice is shown, the pane sets `api.panes.setOuterPanes(pane.outerPanes)`, and sets
  null when Practice hides. The core asks the outer panes only from main, after the view's own focus target turns
  the move down (`src/renderer/pane-targets.ts` `focusFromMain`); from the side bar, Alt+l goes to `focusMain`. So
  the list never reaches these moves.
  - `move('left')` while focus is `'interviewer'` calls `view.focusColumn()` (08) and returns true. The chat view's
    focus target returns false at its left edge (`src/plugins/chat/page/chat-view.ts` `movePane`), and the ask box
    sets no focus target, so both reach it.
  - `move('right')` while focus is `'main'` and the pane is shown gives the pane the keys and returns true. The
    workspace's focus target (08) returns false for `right`, so the column reaches it.
  - Every other move returns false. (AGENTS.md § A focus target: a view never binds Alt+hjkl; the outer panes are
    kept across scope changes.)
- The outer panes' `resize` is `workspace.sideResizeTarget`. Every move takes the DOM focus with it.
- `modeHidden()` calls the mount's `hidden()` and, while focus is `'interviewer'`, calls `view.setFocus('main')`, so
  the next show gives the column the keys.
- The ask box sends on Enter in insert mode and in normal mode, as the chat box does (`chatBoxBinds` in
  `src/plugins/keymap.ts`). `Cmd+Enter` stays Submit in `practice.ask`: design.md § The mode binds Submit in every
  Practice scope, and `docs/keymap.md` § Layers keeps Cmd for send or submit. Shift+Enter, which no bind takes, adds a
  line.
- Known limit: while a chat view is mounted and holds the keys, the scope is chat's `chat.chat`, where `⌘↩` is
  `chat.sendNow` (`src/plugins/keymap.ts` 485) and `⌘'` has no bind. Run and Submit do not fire from the mounted chat
  view; the user presses Alt+h to the column first. 09 binds nothing in `chat.chat`.
- Esc in the ask box's normal mode runs `askLeave`, which calls `view.focusColumn()` (docs/keymap.md § Layers: Esc in
  a box's normal mode leaves the box). The pane has no frame scope of its own.
- `send()` with text that trims to empty logs `ask ignored: empty` and does nothing else. A second `send()` while
  `askInterviewer` is pending logs `ask ignored: sending`. A rejected `askInterviewer` keeps the text, toasts
  `Could not start the interviewer: <errorText>` (tone `error`) and logs `ask failed: <errorText>`.
- The import box is a dialog like `src/plugins/sessions/page/rename-dialog.ts`: `createDialog('Import problems',
  { hasActions: false })`, a `textBoxInput('practice-import-input')` in an `inputFrame`, the `practice.import` scope
  pushed while open, and a base-scope change cancels it. Closing gives the focus back to what held it before.
- `accept()` with text that trims to empty keeps the box open with the problem `Type what to import.` and logs
  `import refused: empty`. A request calls `startImport(trimmed)`. On success the box closes, the page toasts
  `Import session started: follow it in Sessions mode` (tone `success`) and logs `import started: <request>`. A
  rejection keeps the box open with `errorText(error)` as its problem and logs `import failed: <errorText>`. A second
  `accept()` while one is pending does nothing.
- `a` on the list needs an anchor (it is not one of `VIM_KEYS` in `src/shared/vim-keys.ts`). 07's `ListKit.importHint`
  slot (`span.practice-import-hint`, which the default `list` part places in its key strip) is the place: 09 fills it
  with `deps.keys.anchor(span, 'practice.importStart', 'practice.list')`, label `import`. The ask frame carries a box
  hint anchor for `practice.askSend`. (AGENTS.md § Key hints.)
- Log lines (each logged with `log(text)`, which the page prints as `[practice] <text>`), verbatim:
  `interviewer pane shown`, `interviewer pane hidden`, `interviewer needs an open problem`,
  `ask box shown for <slug>`, `interviewer mounted <slug>`, `interviewer focused`, `interviewer left`,
  `ask ignored: empty`, `ask ignored: sending`, `ask failed: <errorText>`, `import box opened`,
  `import box closed`, `import refused: empty`, `import started: <request>`, `import failed: <errorText>`.
  `interviewer focused` logs each time the pane takes the keys; `interviewer left` each time it gives them to the
  column. `import box closed` logs on every close, accept and cancel alike. Task 10 expects these lines.

Keymap entries (`src/plugins/keymap.ts`):
- `{ keys: '<Leader>vi', scope: 'any', command: 'practice.toggleInterviewer' }` beside `<Leader>vd`.
- `{ keys: 'a', scope: 'practice.list', command: 'practice.importStart' }`.
- `practice.ask`: `<CR>` `where: 'box'` → `practice.askSend`; `<CR>` `mode: 'insert'` → `practice.askSend`;
  `<Esc>` `where: 'box'` → `practice.askLeave` (the `chatBoxBinds` shape).
- `practice.import`: `<CR>` → `practice.importAccept`; `<Esc>` → `practice.importCancel` (the `sessions.rename` shape).
- Add `practice.ask` to the `<C-n>` main-view scope list (07 opened it) and bind `<D-'>` → `practice.run` and `<D-Enter>` → `practice.submit` in `practice.ask`, as 08 binds them in its four scopes. `practice.import` gets
  neither: a dialog keeps its own keys.

`docs/keymap.md`: the leader table's `v` row (line 149) adds `` `vi` show or hide the Practice interviewer ``; the
side-bar list paragraph, where 07 added the Practice list, adds that `a` on it starts an import.

Layout contract additions (`layouts/layout.d.ts`, `default/layout.js`, `default/layout.css`, kit in
`page/layout/practice-kit.ts`):
- `interface AskBoxInput { problemTitle: string; hint: string }`. `hint` is
  `Ask about the problem. The interviewer asks guiding questions and gives no answers.`
- `interface AskBoxKit extends PracticeKit { textBox(parent: HTMLElement): HTMLElement }`: places the app's ask frame
  (`ui-input practice-ask-box`, holding the vim box and the send hint) and returns it. A second call throws
  `textBox placed twice`. A part that leaves it out gets the frame appended at the end of its root.
- `interface ImportBoxInput { problem: string | null; hint: string }`. `hint` is
  `Describe the problems to add, for example "add the Blind 75 graph problems". An agent session imports them.`
- `interface ImportBoxKit extends PracticeKit { textBox(parent: HTMLElement): HTMLElement }`: the rename dialog's
  `RenameDialogKit.textBox` rules.
- `default`: `askBox` draws the title as a heading, the hint, then the frame; `importBox` draws the frame, the problem
  when not null, then the hint (the sessions `renameDialog` order).

GIVEN the pane is hidden and Two Sum is open WHEN `toggleInterviewer` runs and `interviewerOf` answers null THEN the
pane shows the ask box, focuses it at the end in insert mode, sets scope `practice.ask` and logs
`interviewer pane shown`, `ask box shown for two-sum` and `interviewer focused`.
GIVEN the pane opens and `interviewerOf('two-sum')` answers `s1` THEN `mountChat(body, 's1')` runs once, no ask box is
created, `shown()` runs once and `interviewer mounted two-sum` logs.
GIVEN the ask box holds `how do I start` WHEN `send()` runs and `askInterviewer` answers `s2` THEN `askInterviewer`
got `('two-sum', 'how do I start')`, the ask box is destroyed and `mountChat(body, 's2')` runs.
GIVEN a mounted view WHEN `problemOpened('lru-cache', 'a2')` runs THEN the old mount's `dispose` runs before
`interviewerOf('lru-cache')` is asked.
GIVEN a mounted view for `('two-sum', 'a1')` WHEN `problemOpened('two-sum', 'a1')` runs again (a `changed` refresh or
a Submit) THEN the mount stays and `interviewerOf` is not asked.
GIVEN `interviewerOf('two-sum')` is pending WHEN `problemOpened('lru-cache', 'a2')` runs and then the two-sum answer
`s1` arrives THEN nothing mounts for `s1`.
GIVEN the pane holds the keys WHEN `outerPanes.focus.move('left')` runs THEN it returns true and `view.focusColumn()`
runs; its `setFocus('main')` calls `columnTookKeys()`, the mount's `hidden()` runs and `interviewer left` logs.
GIVEN the pane is hidden WHEN `outerPanes.focus.move('right')` runs THEN it returns false.
GIVEN the import box is open WHEN `accept()` runs with `add two sum` and `startImport` resolves THEN the box closes,
its scope pops, the toast is `Import session started: follow it in Sessions mode` and `import started: add two sum`
logs.

Tests:     `interviewer-pane.test.ts`, on the fake DOM (`installFocusFakeDom`, `src/shared/page/test-dom.ts`), a fake
           editor host shaped like `fakeEditorHost` in `src/plugins/backlog/page/backlog-view.test.ts`, a fake
           `mountChat` that records each mount's `shown`, `hidden` and `dispose` calls, and deferred channel answers:
- `opens on the ask box when the attempt has no interviewer` — the first GIVEN above; asserts the scope
  `practice.ask`, the focus options `{ insertAtEnd: true }` and the three lines in order. Catches a pane that
  mounts chat with no session.
- `mounts the interviewer's chat when the attempt has one` — mount args `(body, 's1')`, one `shown()`, zero editors
  created. Catches a pane that shows the ask box over a live interviewer.
- `send` table, one row each: text `how do I start` → `askInterviewer('two-sum', 'how do I start')`, mount `s2`;
  text `   ` → no invoke, line `ask ignored: empty`; second send while pending → one invoke, line
  `ask ignored: sending`; invoke rejects `Error('no harness')` → box kept with its text, toast
  `Could not start the interviewer: no harness` tone `error`. Catches a double launch and a lost question.
- `drops an interviewer answer for a problem no longer open` — the race GIVEN; asserts zero mounts. Catches the
  wrong problem's interviewer in the pane.
- `remounts only when the pair changes` table: `('two-sum', 'a1')` then `('two-sum', 'a1')` → one mount, zero
  `dispose`, `interviewerOf` asked once, the ask box's typed text kept; `('two-sum', 'a1')` then `('two-sum', 'a2')`
  → the first mount's `dispose` ran, `interviewerOf` asked twice; `('two-sum', 'a1')` then `('lru-cache', 'a3')` →
  the same. Catches an autosave refresh that wipes the interviewer, and a stale interviewer after a fresh attempt.
- `outer panes` table, with a fake view whose `setFocus` and `focusColumn` record calls: focus `interviewer`, `left` →
  true, `focusColumn` once; focus `main` and the pane shown, `right` → true, `setFocus('interviewer')` once, line
  `interviewer focused`; pane hidden, `right` → false; any focus, `up` and `down` → false. Catches Alt+h trapped in
  the chat view.
- `gives up the keys when the column takes them` — `columnTookKeys()` while mounted and holding the keys runs
  `hidden()` once and logs `interviewer left`; a second call runs it no more.
- `modeHidden hides the mount and keeps it` — `hidden()` once, `dispose` zero.
           `import-box.test.ts`, on the fake DOM, with a fake channel and a pushed-scope fake that records push, pop and
           the base-change listener (as `rename-dialog.test.ts` does):
- `accept` table: `add two sum` resolves → closed, scope popped, toast and line as the GIVEN; `  ` → open, problem
  `Type what to import.`, no invoke; rejects `Error('no profile')` → open, problem `no profile`, line
  `import failed: no profile`; a second accept while pending → one invoke.
- `cancel and base change close without starting` — each row closes, pops, logs `import box closed` and makes no
  invoke.
           A row in the existing layout-contract check, `src/shared/layouts/layout-contracts.test.ts`, needs no edit:
           it type-checks every owner's `layout.d.ts`.

Approach:  Wire the pane and the box in `page/practice-view.ts` and `page/start.ts`. The command handlers
           `toggleInterviewer`, `askSend`, `askLeave`, `importStart`, `importAccept` and `importCancel` call the
           matching members. The view appends `pane.element` into `workspace.sidePane`, calls `columnTookKeys()` from
           07's `setFocus` when focus leaves `'interviewer'`, calls `problemOpened(problem.summary.slug,
           problem.attempt.id)` from 08's `applyOpened`, and calls `modeHidden()` and `setOuterPanes(null)` from the
           mode's `hidden`. The mode's `shown` sets `setOuterPanes(pane.outerPanes)`. The import box's scrim goes to
           `api.areas.overlay` as the rename dialog's does. Both parts redraw on a layout change through `redraw()`.

Done when: `npm run typecheck` passes, `npm run lint` passes, and `npm test -- src/plugins/practice/page` passes
           with the tests above. Live checks go to task 12 — Final verification.
Commit:    one commit for the group

## Proof

