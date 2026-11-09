# 08 — Practice page: problem workspace

Status: done
Type: Task
Wave: 5 · Depends on: 07
Plan: [plan.md](plan.md)

Files:     modify `src/shared/page/ui/split.ts` · modify `src/shared/page/ui/split.css` · test
           `src/shared/page/ui/split.test.ts` · create `src/plugins/practice/page/problem-workspace.ts` · create
           `src/plugins/practice/page/workspace-state.ts` · create `src/plugins/practice/page/case-text.ts` · modify
           `src/plugins/practice/page/practice-view.ts` · modify `src/plugins/practice/page/start.ts` · modify
           `src/plugins/practice/page/practice.css` · modify `src/plugins/practice/page/layout/practice-kit.ts` · modify
           `src/plugins/practice/page/layout/read-layout.ts` · modify `src/plugins/practice/layouts/layout.d.ts` · modify
           `src/plugins/practice/layouts/default/layout.js` · modify `src/plugins/practice/layouts/default/layout.css` ·
           modify `src/plugins/practice/manifest.ts` · modify `src/plugins/practice/contract.ts` · modify
           `src/plugins/keymap.ts` · modify `docs/keymap.md` · modify `AGENTS.md` (§ A resize target) · test
           `src/plugins/practice/page/workspace-state.test.ts` · test `src/plugins/practice/page/case-text.test.ts` · test
           `src/plugins/practice/page/start.test.ts` (rows added) · modify
           `src/shared/plugin-part-harness.test-support.ts` (`countingEditors` gains a working `createDocument`)
Consumes:  `PracticeChannel` invoke `open(slug): OpenedProblem`, `saveCode(slug, text)`, `saveNotes(slug, text)`,
           `saveCustomCases(slug, text)`, `run(slug): JudgeResult`, `submit(slug): JudgeResult`, `peek(slug): { approach:
           string; reference: string }`, message `changed` ← 05; `OpenedProblem`, `SubmissionRecord`, `JudgeResult`,
           `CaseResult`, `Verdict`, `Attempt` ← 05 (`contract.ts`); `FunctionSignature`, `DesignSignature`, `JsonValue` ←
           04 (`problem.ts`). From 07: `createPracticeView`, `PracticeView.main`, `PracticeState.openSlug`,
           `PracticeFocus`, `PracticeView.setFocus(focus)`, `PracticePlace`, `practicePlaceSlot`, the layout parts and
           kit. From the tree:
           `EditorHost.createDocument(parent, doc, options: DocumentOptions, events: DocumentEditorEvents):
           DocumentEditor` (`src/contracts/editor.ts` 183), `createEditorBoxes`/`keepFocusedBox`
           (`src/shared/page/editor-boxes.ts`), `startAutosave`/`saveState`/`startSave`/`finishSave`/`saveLabel`/
           `DraftRevisions` (`src/shared/page/autosave.ts`), `onPageHide` (`src/shared/page/page-hide.ts`),
           `createConfirmPrompt` (`src/shared/page/confirm-prompt.ts`), `createMarkdownMount`
           (`src/shared/page/markdown-mount.ts`), `tabStrip`/`tab` (`src/shared/page/ui/tabs.ts`), `scrollContent`/
           `scrollToEdge` (`src/shared/content-scroll.ts`), `createSplit` (`src/shared/page/ui/split.ts`).
Produces:  in `src/shared/page/ui/split.ts`: `SplitOptions.axis?: 'row' | 'column'` (default `'row'`) and
           `SplitOptions.sizedPane?: 'start' | 'end'` (default `'start'`); `SplitDividerOptions.axis?: 'row' | 'column'`;
           `Split.setEndHidden(hidden: boolean): void`.
           In `page/problem-workspace.ts`: `createProblemWorkspace(deps: ProblemWorkspaceDeps): ProblemWorkspace` with
           `ProblemWorkspace { element: HTMLElement; sidePane: HTMLElement; setSidePaneShown(isShown: boolean): void;
           sideResizeTarget: ResizeTarget; show(problem: OpenedProblem): Promise<void>; refresh(problem:
           OpenedProblem): void; pane(): WorkspacePane; focus(): void; focusTarget: FocusTarget; resizeTarget:
           ResizeTarget; setLayouts(shown: ShownLayouts<PracticeLayout>): void; commands: Record<WorkspaceCommand, () =>
           void>; showTab(tab: string): void; openSubmissionRow(time: string): void; mayStop(): string | null; dispose():
           void }`, `type WorkspacePane = 'problem' | 'editor' | 'console'`.
           In `page/practice-view.ts`: `PracticeView.focusColumn(): void` (gives the column its keys back; 09 calls it);
           `applyOpened(problem: OpenedProblem): void`, the one function that applies an `open` result (09 adds a call).
           In `page/workspace-state.ts`: `type ProblemTab = 'description' | 'submissions' | 'notes' | 'solution'`; `type
           ConsoleTab = 'testcase' | 'result'`; `type DraftId = 'code' | 'notes' | 'customCases'`; `WorkspaceState`,
           `WorkspaceAction`, `workspaceReducer`, `VERDICT_LABELS: Record<Verdict, string>`.
           In `page/case-text.ts`: `valueText(value: JsonValue | null): string`; `caseInputText(signature:
           FunctionSignature | DesignSignature, input: JsonValue): string`.
           In `contract.ts`: `practiceShowTabCommand: CommandKey<string, 'practice.showTab'>`,
           `practiceOpenSubmissionRowCommand: CommandKey<string, 'practice.openSubmissionRow'>`; `PracticePlace` gains
           `pane: 'problem' | 'editor' | 'console'`, `problemTab: 'description' | 'submissions' | 'notes'`,
           `consoleTab: 'testcase' | 'result'`.

Decisions:
- **A column `Split`** (design.md § The mode: "Every divider is a `Split`"; `createSplit` today lays panes side by
  side only, split.ts 341-383, and `createSplitDivider` measures x only, 255-334). The split deepens rather than a
  second divider module:
  - `createSplitDivider` with `axis: 'column'`: `pointerAt` reads `clientY`; `measure()` returns the start edge and
    span along y (`createSplit` passes `rootRect.top` as `left` and `rootRect.height - handleRect.height` as `span`);
    the prompt's ends are `PANE_RESIZE_COMMANDS.up` with `▴` and `PANE_RESIZE_COMMANDS.down` with `▾` (as
    `src/shared/page/pane-tree/pane-tree-view.ts` 171 draws them); `nudge` returns false for `left` and `right` and
    maps `up` → `left`, `down` → `right` before the existing `sizesEnd` flip and `nudgedSplitWidth`. Row behaviour
    is unchanged.
  - `createSplit` passes `axis` and `sizedPane` through; with `sizedPane: 'end'` `show` sets `--ui-split-end` in
    place of `--ui-split-start` and the root gets `is-end-sized`. A column split adds `is-column` and never toggles
    `is-stacked` (its ResizeObserver check runs only for `row`).
  - `Split.setEndHidden(hidden)` mirrors `setStartHidden`: the root toggles `is-end-hidden`, and `split.css` hides
    `.ui-split-end` and `.ui-split-handle` under it with one full track (`grid-template-columns: 1fr`, and
    `grid-template-rows: 1fr` where the split stacks), as the `is-start-hidden` rules do. A hidden handle has no
    layout box, so `nudge` returns false.
  - `split.css`: `.ui-split.is-column` uses `grid-template-columns: 1fr` and `grid-template-rows: minmax(0,
    calc(var(--ui-split-start) * 1px)) var(--wg-space-1) minmax(var(--ui-split-end-min, 0), 1fr)`;
    `.ui-split.is-end-sized` swaps the sized track to the end (`minmax(0, 1fr)` first, `minmax(0,
    calc(var(--ui-split-end) * 1px))` last) for either axis; a column handle has `cursor: row-resize` and its
    `::after` line runs horizontally (`left: 0; right: 0; top: 50%; height: 1px`). The 640px media rule and the
    `is-stacked` rules select `.ui-split:not(.is-column)`.
  - AGENTS.md § A resize target, the sentence "returns false when the direction's axis is not its own (a side-by-side
    `Split` given up or down)" becomes "(a side-by-side `Split` given up or down, a column `Split` given left or
    right)".
- **The stack** (design.md § The mode): the stacked column is `div.practice-column`, a column split `outer` (`axis:
  'column'`, `stateKey: 'problemHeight'`, `initial: 280`, `min: 120`, `endMin: 240`) whose start is the problem pane
  and whose end is a column split `inner` (`axis: 'column'`, `sizedPane: 'end'`, `stateKey: 'consoleHeight'`,
  `initial: 200`, `min: 96`, `endMin: 160`) holding the editor pane (start) and the console (end). Both persist
  through `deps.uiState`; `dispose` disposes both. 07's `div.practice-main` holds the `noProblem` part until the
  first open, then `workspace.element`.
- **The side slot for 09** (design.md § The mode: the interviewer pane sits right of the whole column, hidden until
  toggled, its width in `uiState`): `ProblemWorkspace.element` is `div.practice-workspace`, the root of a row split
  `side` (`createSplit`, `axis: 'row'`, `sizedPane: 'end'`, `stateKey: 'interviewerWidth'`, `initial: 380`, `min:
  280`, `endMin: 400`). Its start holds `div.practice-column`; its end holds `ProblemWorkspace.sidePane`
  (`div.practice-side`, empty). 08 builds nothing inside the slot; 09 fills it.
  - The slot starts hidden: `side.setEndHidden(true)` at build. `setSidePaneShown(isShown)` calls
    `side.setEndHidden(!isShown)`. 09 alone calls it.
  - `sideResizeTarget` is the `side` split. The workspace's `resizeTarget` nudges the pane's column divider first
    (see Resize target), then `side`, so Alt+Shift+h/l from the column resizes the interviewer while it shows and
    returns false while it is hidden.
  - The workspace's focus target returns false for `left` and `right`. The core then asks the outer panes 09 sets.
  - Below `min` plus `endMin` the row split stacks, as every row `Split` does: the column above, the slot below.
  - `dispose` disposes `side` too.
- **Giving the column its keys back** (`PracticeView.focusColumn()`, added to 07's view): it calls
  `setFocus('main')`, which renders the column's scope, resize target and focus target, then `workspace.focus()`,
  which focuses the pane that held the keys last. 09 calls it when the interviewer gives up the keys.
- **Focus inside the workspace** (AGENTS.md § A focus target): `move('down')` problem → editor → console, `move('up')`
  back, each returning true; every other move returns false (left reaches the side bar through `focusSideBar`). The
  pane holding the keys sets the base scope: problem → `problem`, editor → `editor`, console → `console`; 07's
  `scopeOf` reads `workspace.pane()` while `focus` is `main`. Each pane change calls `deps.paneChanged()`, which runs
  07's render (scope, then resize target, then focus target), and logs `problem focused`, `editor focused` or
  `console focused`. Focus `editor` calls the document editor's `focus()`; leaving it calls `blur()`. Each open
  focuses `problem` and logs `problem focused`, even when `problem` already held the keys, so the statement reads
  first; a place restore applies the place's `pane` instead.
- **Resize target** (AGENTS.md § A resize target, docs/keymap.md "Alt+Shift+hjkl": the lower divider, else the upper):
  problem → `outer`, editor → `inner`, console → `inner`; each then falls to `side` for `left` and `right`.
- **The problem pane** (design.md § The mode): the layout's `problemPane` part places the slots `tabs` (the app's
  `tabStrip` of `tab('Description')`, `tab('Submissions')`, `tab('Notes')`, `tab('Solution')`, `is-active` on the
  shown one; a click runs `practiceShowTabCommand` with the tab id through `runKey`) and `body`
  (`div.practice-tab-body`, tabIndex -1, the pane that scrolls). The app draws one tab part into `body` per render
  of the shown tab:
  - `description`: `descriptionTab(parent, { title, difficulty, tags, lists }, kit: DocKit)`; `kit.document(parent)`
    mounts `statement` rendered by `deps.markdown.document` through a `createMarkdownMount` the draw's rollback
    disposes (backlog-view.ts 820-851).
  - `submissions`: one `submissionRow(parent, { time, verdict, verdictLabel, passed, total, runtime }, kit)` per
    record, newest first (sorted by `time` descending), the app setting the click (`practiceOpenSubmissionRowCommand`
    with the record's `time`) and `is-selected`/`is-cursor` on the cursor row; `empty(parent, { reason:
    'noSubmissions', filter: '' }, kit)` with none. Enter (`openSubmission`) or a click shows
    `submissionCode(parent, { time, verdictLabel }, kit: DocKit)` whose `document` mounts the markdown of a ```` ```cpp ```` fence
    around the record's `code` (read-only by construction; no editor). Esc (`closeSubmission`) returns to
    the rows with the cursor kept. `time` shows as `YYYY-MM-DD HH:mm` in local time, parsed from the record's ISO
    8601 `time`.
  - `notes`: `notesTab(parent, kit: BoxKit)`; `kit.textBox(parent)` frames (`ui-input practice-box
    practice-box--notes`) and mounts the notes vim box with the draft text. `i` (`editBox`) focuses the box; Esc in
    the box's normal mode (`leaveBox`) blurs it and focuses the tab body.
  - `solution`: `solutionTab(parent, { approach, reference } , kit: DocKit)` whose `document` mounts the markdown of
    `approach` followed by a ```` ```cpp ```` fence of `reference`.
  - Each change of the problem pane's shown tab logs `problem tab <title>` (`Description`, `Submissions`, `Notes`,
    `Solution`).
  - **Peek** (design.md § Progress: opening the Solution tab drops the problem to the first step): selecting
    `solution` while `attempt.peeked` is false and no peek is held dispatches `askPeek`, which keeps the shown tab and
    shows the shared confirm (`createConfirmPrompt`, title `Open the solution?`, body `This attempt counts as
    peeked, and the problem goes back to the first review step.`, keep `Keep solving` → `confirmNo`, confirm `Open
    it` → `confirmYes`, scope `practice.confirm`, `drawBody` through the layout's `confirmBody`, as backlog-view.ts
    380-430). Showing the confirm logs `solution confirm asked`. `confirmYes` invokes `peek(slug)`, logs `peeked
    <slug>`, stores the answer and shows `solution`. With
    `attempt.peeked` already true, selecting `solution` invokes `peek` with no prompt (it changes nothing more). A
    failed peek logs `not peeked <slug>: <error>`, toasts it and keeps the tab.
  - `j`/`k`/`gg`/`G` (`paneDown`/`paneUp`/`paneTop`/`paneBottom`): on `submissions` rows they move the cursor (held
    at the ends); on every other tab they scroll `body` a line or to an edge. `<C-j>`/`<C-k>`/`<C-S-j>`/`<C-S-k>`
    (`lineDown`/`lineUp`/`halfPageDown`/`halfPageUp`) scroll `body` (docs/keymap.md "Ctrl+hjkl"), through
    `scrollContent` as backlog-view.ts 1254-1262.
- **The editor pane**: the layout's `editorPane(parent, { fileName: 'solution.cpp' }, kit: EditorPaneKit)` places
  `editor` (`div.practice-editor`, the document editor's parent, filling its height) and `saveState`
  (`span.practice-save-state`, whose text the app sets to `saveLabel(saveState(draft), draft.saveError)` for the
  `code` draft). On each `show` the app destroys the old document editor and calls `deps.editor.createDocument(
  editorSlot, problem.code, { fileName: 'solution.cpp', readOnly: false, line: 1 }, events)`. Events: `changed(text)`
  dispatches `draftChanged code`; `write()` (`:w`) saves `code` at once; `writeQuit()` saves at once then focuses
  `problem`; `quit()` focuses `problem`; `modeChanged` does nothing. C++ highlighting comes from the file name
  (design.md § The mode; `@codemirror/language-data` lists C++).
- **The console** (design.md § The mode, § Judging): the layout's `consolePane` part places `tabs` (`tab('Testcase')`,
  `tab('Result')`), `actions` and `body`. `actions` is `span.practice-console-actions` holding the app's two buttons,
  `Run` and `Submit` (`textButton` from `src/shared/page/ui/button.ts`, never focused), each with a control-hint anchor
  `deps.keys.anchor(hint, 'practice.run' | 'practice.submit')` given **no scope**, since the keys fire in four scopes
  (AGENTS.md § Key hints: an anchor with no scope always shows and places the bind in every scope). Tab bodies:
  - `testcase`: `testcaseTab(parent, kit: BoxKit)`, the custom-cases vim box over `customCases` text, `i`/Esc as the
    notes box.
  - `result`: `resultTab(parent, input: ResultInput, kit: ResultKit)`, `ResultInput { state: 'empty' | 'running' |
    'done' | 'failed'; kind: 'run' | 'submit' | null; verdict: 'accepted' | 'wrongAnswer' | 'timeLimit' |
    'runtimeError' | 'compileError' | null; verdictLabel: string | null; passed: number; total: number; runtime:
    string | null; message: string | null; compileOutput: string | null; stderr: string | null }`; `runtime` is
    `<ms> ms`; `message` the failed invoke's error; `compileOutput` set for `compileError`; `stderr` the failing
    case's `stderr` for `runtimeError`. `kit.failingCase(parent)` places the slot the app draws `caseResult(parent,
    input: CaseResultInput, kit)` into when `failing` is not null: `CaseResultInput { label: string; source: 'example'
    | 'custom' | 'hidden'; input: string; expected: string; output: string; stdout: string }`, `label` `Case
    <index + 1>`, `input` from `caseInputText`, `expected`/`output` from `valueText` (`output` null → `No output`).
  - `VERDICT_LABELS`: `accepted` `Accepted`, `wrongAnswer` `Wrong Answer`, `timeLimit` `Time Limit Exceeded`,
    `runtimeError` `Runtime Error`, `compileError` `Compile Error` (design.md § Judging).
- **Case text**: `caseInputText` with a `function` signature and an array input of the params' length writes one
  line per param, `<name> = <valueText(value)>`; any other input (a design case, a length mismatch) is
  `JSON.stringify(input)`. `valueText` is `JSON.stringify(value)`; `null` → `null`.
- **Run and Submit** (`run`, `submit`; design.md § Judging): with no problem open they log `no problem open` and toast
  `Open a problem first`. While a judge call is in flight a second logs `judge busy` and does nothing. Otherwise: save
  every unsaved draft at once (`code`, and `customCases` for Run) and await them, dispatch `judgeStarted` (log `run
  started <slug>` or `submit started <slug>`), show the `result` tab, invoke `run(slug)` or `submit(slug)`, dispatch
  `judgeDone` with the result (log `run <slug>: <verdict> <passed>/<total>` or `submit <slug>: <verdict>
  <passed>/<total>`, `<verdict>` the `Verdict` value, as `accepted` or `wrongAnswer`) or `judgeFailed` with the error
  text (log `run failed <slug>: <error>` or `submit failed <slug>: <error>`). After a Submit the workspace invokes
  `open(slug)` and applies it through `refresh`, so the Submissions tab and the summary show the new record. The
  list follows through 05's watch: the Submit writes `progress.json` and `submissions/`, 05 sends `changed`, and
  07's handler reloads the list. A failed save stops the judge call and toasts the error.
- **Autosave** (design.md § The mode: notes and the editor autosave; `:w` saves at once): one `startAutosave` over the
  workspace store with three drafts, ids `code`, `notes`, `customCases`, each `DraftRevisions & { text: string }`;
  `save(id, { slug, text })` invokes `saveCode`, `saveNotes` or `saveCustomCases`; `delayMs: () => 800` (the
  constant `AUTOSAVE_DELAY_MS = 800` in `problem-workspace.ts`); `onPageHide` from `src/shared/page/page-hide.ts`;
  `saveFinished` logs `saved code`, `saved notes` or `saved custom cases` on success. "Save at once" dispatches
  `saveStarted`, invokes, then `saveFinished`, as autosave's own `saveDraft` does, so the pending timer later finds
  the draft saved. `show` of a different slug first saves every unsaved draft of the current problem at once and
  awaits it. `mayStop` returns `Practice is still saving <file>` (`solution.cpp`, `notes.md` or `custom-cases.json`)
  while a draft is unsaved, else null.
- **Refresh** (`changed`, and after Submit): 07's `changed` handler also invokes `open(openSlug)` when a problem is
  open and calls `workspace.refresh`. `refresh` replaces the statement, signature, summary, attempt and submissions;
  for each draft it replaces the text (and the editor's or box's text through `setText`) only when the draft is saved
  and the new text differs, so an unsaved edit is never overwritten. `refresh` for another slug than the shown one is
  ignored. Main decides a fresh attempt inside `open`; the page calls it again on refresh, so it relies on `open`
  starting a fresh attempt at most once per due date (see 05).
- **One place applies an `open` result**: `practice-view.ts` routes every `open` result, the user's open, a place
  restore, a `changed` refresh and the post-Submit refresh alike, through one function, `applyOpened(problem)`, which
  calls `workspace.show` or `workspace.refresh`. 09 adds its `problemOpened(slug, attemptId)` call there; 09 keeps its
  mount while that pair is unchanged.
- **Opening** (`show`): resets the tabs to `description` and `testcase`, the result to `empty`, the submissions cursor
  to the newest, drops a held peek, sets the three drafts saved at revision 0 with the opened texts, builds the
  editor, and redraws. Restoring a place applies `pane`, `problemTab` and `consoleTab` (never `solution`, which
  `PracticePlace.problemTab` cannot hold).
- **Tabs keys** (design.md § The mode: `gt`/`gT` in the problem pane): `nextTab`/`prevTab` cycle the problem pane's
  tabs in `practice.problem` (wrapping; reaching `solution` goes through the peek rule) and, extending the table to the
  console, the console's two tabs in `practice.console`. `showTab` (the click) takes any of the six tab ids; an id no
  tab holds logs `no tab <id>`.
- **`editBox` off a box tab**: `i` is bound in `practice.problem` and `practice.console` for every tab. On a tab with
  no box (every tab but Notes and Testcase, and Submissions' code view) it logs `no box on this tab` and does
  nothing else.
- **Manifest** (07's rule: the page task that handles a command declares it): page commands `run` (`run the examples
  and your cases`, group `judge`), `submit` (`submit the solution`, `judge`), `nextTab` (`next tab`, `tabs`),
  `prevTab` (`previous tab`, `tabs`), `showTab` (`show this tab`, `tabs`, `arg: 'string'`), `paneDown`/`paneUp`/
  `paneTop`/`paneBottom` (`next row or line`, `previous row or line`, `top`, `bottom`, group `pane`), `lineDown`/
  `lineUp`/`halfPageDown`/`halfPageUp` (`scroll a line down`, `scroll a line up`, `scroll half a page down`, `scroll
  half a page up`, `pane`), `openSubmission` (`show the submission's code`, `pane`), `openSubmissionRow` (`show this
  submission's code`, `pane`, `arg: 'string'`), `closeSubmission` (`back to the submissions`, `pane`), `editBox`
  (`edit the box`, `box`), `leaveBox` (`leave the box`, `box`), `confirmYes` (`open it`, `confirm`), `confirmNo` (`keep
  solving`, `confirm`); scope `confirm: 'In a practice confirmation'`.
- **Keys** (`src/plugins/keymap.ts`, the Practice block 07 opened; design.md key table; docs/keymap.md):
  - `<D-'>` → `practice.run` and `<D-Enter>` → `practice.submit` in each of `practice.list`, `practice.problem`,
    `practice.editor`, `practice.console`, with no `where`: a chord fires inside a box and the editor too, ahead of
    vim (keymap.ts 748-750, backlog's `<D-Enter>` in `backlog.editor`). The interviewer's scope is 09's to bind.
  - `practice.problem`: `j`/`k`/`gg`/`G` → `paneDown`/`paneUp`/`paneTop`/`paneBottom`; `<CR>` → `openSubmission`;
    `<Esc>` → `closeSubmission` (`where: 'page'`); `gt` → `nextTab`; `gT` → `prevTab`; `i` → `editBox` (`where:
    'page'`); `<Esc>` → `leaveBox` (`where: 'box'`).
  - `practice.console`: `gt`/`gT` → `nextTab`/`prevTab`; `i` → `editBox` (`where: 'page'`); `<Esc>` → `leaveBox`
    (`where: 'box'`); `<C-j>`/`<C-k>`/`<C-S-j>`/`<C-S-k>` → the scroll commands over the console body.
  - `practice.problem`: `<C-j>`/`<C-k>`/`<C-S-j>`/`<C-S-k>` → `lineDown`/`lineUp`/`halfPageDown`/`halfPageUp`.
  - `practice.confirm`: `y` → `confirmYes`, `n` → `confirmNo`, `<Esc>` → `confirmNo`.
  - Anchors (AGENTS.md § Key hints, "every other bind has an anchor"): Run and Submit by the unscoped control hints
    above; `gt`/`gT` by key hints the default `problemPane` and `consolePane` parts draw at their tab strips' ends
    (`kit.keyHint(header, 'prevTab', { label: 'previous tab' })` at the start, `kit.keyHint(header, 'nextTab', {
    label: 'next tab' })` at the end, in each part's kit scope; `kit.edge` is for focus-move prompts only, kit.d.ts
    172-173); `i` by a box hint `kit.keyHint(header, 'editBox', { label: 'edit' })` in `notesTab` and
    `testcaseTab`; `y`/`n` by the confirm prompt's buttons. `j`/`k`/`gg`/`G`, Enter, Esc and the Ctrl scroll keys
    are vim's own (`src/shared/vim-keys.ts`).
- **Layout contract additions** (`layout.d.ts`, `read-layout.ts`'s record, `default/layout.js`), all kits extending
  `PracticeKit`: `problemPane?(parent, kit: TabbedPaneKit): PracticePane` and `consolePane?(parent, kit: ConsoleKit):
  PracticePane` (`TabbedPaneKit { tabs(parent); body(parent) }`, `ConsoleKit extends TabbedPaneKit { actions(parent)
  }`), `editorPane?(parent, input: { fileName: string }, kit: EditorPaneKit): PracticePane` (`EditorPaneKit {
  editor(parent); saveState(parent) }`), `descriptionTab`, `submissionRow`, `submissionCode`, `notesTab`,
  `solutionTab`, `testcaseTab`, `resultTab`, `caseResult`, `confirmBody?(parent, input: { body: string }, kit:
  ConfirmBodyKit)` (`ConfirmBodyKit { keepButton(parent); confirmButton(parent) }`, backlog's shape), with `DocKit {
  document(parent) }`, `BoxKit { textBox(parent) }`, `ResultKit { failingCase(parent) }`; `EmptyReason` gains
  `'noSubmissions'` (text `No submissions yet.`). Kit scopes: `problemPane` and the problem tabs `practice.problem`,
  `editorPane` `practice.editor`, `consolePane`, `testcaseTab`, `resultTab`, `caseResult` `practice.console`,
  `confirmBody` `practice.confirm`; `PracticeBaseScope` becomes `'list' | 'problem' | 'editor' | 'console'` and
  `PracticeKitScope` adds `'confirm'`. The default `resultTab` draws the verdict line (`kit.tag` tone `success` for
  `accepted`, `error` otherwise), `passed/total` and `runtime`, `message`, the compile output and stderr each in a
  `pre.practice-output`, and `Running…` while `running`; `caseResult` labels Input, Expected, Output and Stdout
  (Stdout left out when empty), each value in a `pre.practice-output`.
- **Logs** (task 10 reads them verbatim): `problem focused`, `editor focused`, `console focused`, `problem tab
  <title>`, `solution confirm asked`, `peeked <slug>`, `not peeked <slug>: <error>`, `run started <slug>`, `run
  <slug>: <verdict> <passed>/<total>`, `run failed <slug>: <error>`, `submit started <slug>`, `submit <slug>:
  <verdict> <passed>/<total>`, `submit failed <slug>: <error>`, `no problem open`, `judge busy`, `saved code`, `saved
  notes`, `saved custom cases`, `no tab <id>`, `no box on this tab`.
- **docs/keymap.md**: the Alt+hjkl paragraph's view panes add "the Practice problem pane, editor and console"; the
  Ctrl+hjkl scroll list adds "the Practice problem pane and console"; the gg/G pane list adds "the Practice problem
  pane". Design.md's key table already holds `⌘'`, `⌘↩` and `gt`/`gT`.

GIVEN a problem is open WHEN Alt+j is pressed in the problem pane THEN the editor takes the keys (scope
`practice.editor`), and Alt+j again moves to the console.
GIVEN the editor holds unsaved code WHEN `⌘'` is pressed THEN `saveCode` runs before `run`, the Result tab shows, and
it shows the verdict, passed/total and runtime.
GIVEN a Wrong Answer result WHEN the Result tab draws THEN it shows the failing case's input as `name = value` lines,
the expected answer, the output and its stdout.
GIVEN a Compile Error WHEN the Result tab draws THEN it shows the compile output.
GIVEN the attempt is not peeked WHEN `gt` reaches the Solution tab THEN the confirm shows and the tab does not change
until `y`; `n` keeps the earlier tab and calls no `peek`.
GIVEN typing in the editor WHEN 800 ms pass with no edit THEN `saveCode` runs once; `:w` saves at once.
GIVEN a submission WHEN it finishes THEN the Submissions tab lists it first and Enter on it shows its code.
GIVEN the user's notes box holds unsaved text WHEN main sends `changed` THEN the notes text is kept.
GIVEN the problem pane has focus WHEN Alt+Shift+j is pressed THEN the problem pane grows 24 px and the height is kept
in `uiState` under `problemHeight`.

Tests:
- `createSplit nudge` in `split.test.ts`, rows added to the existing tables (a column split over a root rect `{ top:
  0, height: 800 }` and a handle rect `{ top: 0, height: 4 }`): `column, stored 240, down` → width 264, written 264;
  `column, stored 240, up` → 216; `column, end-sized, stored 200, up` → 224 (the end pane grows); and the off-axis
  table gains `column` rows for `left` and `right` → returns false, width kept. `createSplit prompt`: a column split
  anchors `panes.resizePaneUp` and `panes.resizePaneDown`. Catches a column split reading x or keeping row nudges.
  The `splitWithHandle` helper (split.test.ts 131) gains `axis` and `sizedPane` options: for `column` it passes
  them to `createSplit` and sets the root rect to `{ top: 0, height: 800 }`; the nudge rows read `clientY`.
  `setEndHidden(true)` adds `is-end-hidden` to the root and `setEndHidden(false)` removes it.
- `workspaceReducer` in `workspace-state.test.ts`, one `it.each` per behaviour:
  - `cycles the problem tabs` rows: `nextTab` from `description` → `submissions`; from `notes` with no peek held →
    `askPeek` pending, tab stays `notes`; from `solution` → `description`; `prevTab` from `description` with peek held
    → `solution`. Catches the wrap and the peek gate.
  - `cycles the console tabs`: `testcase` ↔ `result` both ways.
  - `answers the peek prompt` rows: `confirmNo` → prompt gone, tab kept; `peeked` with the answer → tab `solution`,
    peek held.
  - `refresh keeps unsaved drafts` rows: draft `notes` saved with new disk text → replaced; draft unsaved → kept;
    same text → unchanged object.
  - `moves the submission cursor` rows: `paneDown` at the last row stays; `paneTop` → 0.
  - `holds one judge call`: `judgeStarted` while running leaves the state unchanged.
- `caseInputText` and `valueText` in `case-text.test.ts`, rows: function `twoSum(nums: vector<int>, target: int)`,
  input `[[2,7,11,15], 9]` → `nums = [2,7,11,15]\ntarget = 9`; same signature, input `[[1]]` → `[[1]]`; a design
  signature, input `{"ops":["LRUCache"],"args":[[2]]}` → its `JSON.stringify`; `valueText("ab")` → `"ab"`;
  `valueText(null)` → `null`.
- `practicePagePart` in `start.test.ts`, rows added (the fake editor host from `countingEditors` in
  `src/shared/plugin-part-harness.test-support.ts`, timers faked). `countingEditors().host.createDocument` today
  throws `part harness: countingEditors makes no document editor` (line ~1770). 08 replaces the throw: it counts the
  editor in `live` and `made` as `create` does, points `type` at `events.changed`, and returns a `DocumentEditor`
  whose methods do nothing and whose `text()` returns the doc. `type` then drives the last editor made of either kind.
  No test asserts the throw.
  - `saves the code before it runs` — open, type into the document editor, run `run`; the invoke log reads
    `saveCode`, then `run`, and the log holds `run started <slug>` and `run <slug>: accepted 2/2`.
  - `refreshes the problem after a submit` — `submit` resolves; `open` is invoked again with the slug.
  - `autosaves once typing pauses` — two `changed` events 100 ms apart, then 800 ms; `saveCode` invoked once with the
    last text.
  - `asks before the solution` — `showTab` `solution` with `attempt.peeked` false: no `peek` invoked and the log
    holds `solution confirm asked`; then `confirmYes`: `peek` invoked once and the log holds `peeked <slug>`.
  - `opens on the problem pane` — `openProblem`; the log holds `problem focused` and the scope is `practice.problem`.

Done when: `npm run typecheck` passes, `npm run lint` passes, the test gate runs the tests above with
`src/shared/page/ui/split.test.ts` whole and `src/shared/layouts/layout-contracts.test.ts`. The look, the live
autosave, Run and Submit against clang++, the C++ highlighting and the placement check defer to "12 — Final
verification".
Commit:    one commit for the group

## Proof

Commit 8de85a0e · proof: diff read: Split axis/sizedPane/setEndHidden, createProblemWorkspace/ProblemWorkspace/WorkspacePane, focusColumn/applyOpened, workspace-state and case-text exports, practiceShowTabCommand/practiceOpenSubmissionRowCommand, PracticePlace pane/problemTab/consoleTab present; AGENTS.md and DESIGN.md split prose read; typecheck clean; worker ran 77 files 1952 tests and lint clean · concerns: edits outside Files: DESIGN.md (stale Split entry) and practice-state.ts (placeOf); task doc said 'type' drives the code editor but it reaches the last box, so typeDocument was added; split layout, confirm placement, real editor :w/:wq/:q and focus moves unchecked live (task 12)
