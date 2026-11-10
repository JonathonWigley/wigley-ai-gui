# 12 — Schedules mode

Status: not started
Type: Task
Wave: 2 · Depends on: 03
Plan: [plan.md](plan.md)

Read first, beyond plan.md § Mandatory Reads: `src/plugins/backlog/page/start.ts`, `src/plugins/backlog/manifest.ts`,
`src/plugins/backlog/layouts/layout.d.ts` and `src/plugins/backlog/page/followup-editor.ts`. Backlog is the pattern
for a mode with a list, a detail pane, an editor in the detail pane, a list picker and a confirm prompt. Copy its
shape; do not import from it.

Files:
- modify `src/plugins/scheduling/manifest.ts` (commands, scopes, the `layout` setting, `dependsOn.page`)
- modify `src/plugins/keymap.ts` (the binds below; `scheduling.picker` joins `LIST_PICKER_SCOPES`)
- modify `src/plugins/page.ts` (lists `schedulingPagePart`)
- create `src/plugins/scheduling/page/start.ts` (wiring only)
- create `src/plugins/scheduling/page/schedules-state.ts` · test `src/plugins/scheduling/page/schedules-state.test.ts`
- create `src/plugins/scheduling/page/schedule-fields.ts` · test `src/plugins/scheduling/page/schedule-fields.test.ts`
- create `src/plugins/scheduling/page/schedules-view.ts` (DOM: the side bar, the sheet, the editor, the picker and
  confirm openers)
- create `src/plugins/scheduling/page/task-editor.ts` (the editor's vim boxes, as `followup-editor.ts`)
- create `src/plugins/scheduling/page/schedules.css` (only what the app draws itself: panes, slots, boxes)
- create `src/plugins/scheduling/page/layout/read-scheduling-layout.ts`
- create `src/plugins/scheduling/layouts/layout.d.ts`, `src/plugins/scheduling/layouts/default/layout.js`,
  `src/plugins/scheduling/layouts/default/layout.css`
- test `src/plugins/scheduling/page/start.test.ts`
- modify `docs/keymap.md` (the `k` row gains `kt` Schedules), `DESIGN.md` § Surfaces (a **Schedules** bullet with
  the look below)
- read `docs/features/layouts/design.md`: its Adopters table already lists `scheduling` (written ahead, plan.md
  § Docs written ahead). Make the layout contract match that row; edit the row only where the code proves it wrong.

Consumes:
- `ScheduledTask`, `ScheduledTaskView`, `SchedulingState`, `schedulingStateSlot`, `TaskDraft`, `TaskSchedule`,
  `EditorChoices`, `RunHistoryEntry`, `SchedulingChannel` (`saveTask`, `setPaused`, `runNow`, `removeTask`,
  `editorChoices`) in `src/plugins/scheduling/contract.ts` ← 03
- `readSchedule(value: unknown): TaskSchedule | string` and `scheduleText(schedule: TaskSchedule): string` in
  `src/plugins/scheduling/schedule.ts` ← 03
- `schedulingManifest` in `src/plugins/scheduling/manifest.ts` ← 03
- tree: `PagePart`, `PageApi`, `Mode`, `ModeHandle` (`src/contracts/plugin.ts`); `sessionsPageKey` and
  `SessionsPageExports.activate(sessionId)` (`src/plugins/sessions/contract.ts`); `createLayoutParts`,
  `createBaseKit`, `ownerBaseKitDeps`, `kitCommandsOf`, `keyRunner` (`src/shared/page/layout-host/`);
  `createEditorBoxes`, `stepBox` (`src/shared/page/editor-boxes.ts`); `services.picker` (`ListPickerService`);
  `src/shared/page/confirm-prompt.ts`; `LIST_PICKER_COMMANDS` (`src/shared/list-picker-commands.ts`);
  `startDrawingPagePart` (`src/shared/page/layout-host/page-part-harness.test-support.ts`)

Produces:
- `export const schedulingPagePart: PagePart<typeof schedulingManifest>` in `src/plugins/scheduling/page/start.ts`
- in `src/plugins/scheduling/page/schedule-fields.ts`:
  ```ts
  export type ScheduleKind = TaskSchedule['kind'];
  // The editor's schedule rows as text, each '' when its kind does not use it.
  export interface ScheduleFields { kind: ScheduleKind; minute: string; time: string; day: number; at: string; line: string }
  export function fieldsOf(schedule: TaskSchedule): ScheduleFields;
  // The schedule the fields hold, or the reason they do not hold one (readSchedule's reason, or the page's own).
  export function scheduleOf(fields: ScheduleFields): TaskSchedule | string;
  ```
- in `src/plugins/scheduling/page/schedules-state.ts`, a pure state module the view drives; its exported names are
  the implementer's, but it owns these rules: the list's rows from `SchedulingState` (the "+ New task" row first, then
  one row per task in file order), the selection by task id across state changes, the history cursor, the editor
  draft and its changed flag, the draft-to-`TaskDraft` check (`draftOf`, below), and every line of copy pinned below.
- in `src/plugins/scheduling/layouts/layout.d.ts`: `SchedulingLayout` (every part optional) and
  `CompleteSchedulingLayout extends Required<SchedulingLayout>`, with these parts, each appending its root to
  `parent` and returning it (`BacklogLayout`'s form):
  - panes, drawn once per layout set into app-owned containers: `list(parent, kit: ListKit)` (side bar; slot
    `rows`), `detail(parent, kit: DetailKit)` (sheet; slots `notices`, `body`, `history`, `editor`),
    `editor(parent, input: EditorInput, kit: EditorKit)` (into the `editor` slot on each editor open)
  - rows and entries, drawn per item on each render: `newTaskRow(parent, kit: RowKit)`,
    `taskRow(parent, input: TaskRowInput, kit: RowKit)`, `empty(parent, input: EmptyInput, kit)`,
    `notice(parent, input: NoticeInput, kit)`, `taskDetail(parent, input: TaskDetailInput, kit: TaskDetailKit)`,
    `historyRow(parent, input: HistoryRowInput, kit: RowKit)`, `fieldRow(parent, input: FieldRowInput, kit:
    FieldRowKit)`, `pickerRow(parent, input: PickerRowInput, kit: PickerRowKit)`,
    `confirmBody(parent, input: ConfirmBodyInput, kit: ConfirmBodyKit)`
  - inputs: `TaskRowInput { name; scheduleText; next: string; paused: boolean }` (`next` is `Paused` when `paused`), `EmptyInput { reason: 'noTasks' | 'newTask' }`,
    `NoticeInput { kind: 'dev' | 'fileError' | 'loginStart'; text: string; tone: 'neutral' | 'warning' | 'error' }`,
    `TaskDetailInput { name; project; profile; scheduleText; next; controls: { label: string; value: string }[];
    prompt; paused: boolean }`, `HistoryRowInput { when: string; outcome: RunOutcome; text: string; linked: boolean }`,
    `FieldRowInput { field: string; label: string; value: string; hint: string | null; kind: 'box' | 'choice' |
    'multiline' }`, `EditorInput { kind: 'create' | 'edit'; heading: string; envNote: string; problem: string | null }`,
    `PickerRowInput { picker: string; label: string }`, `ConfirmBodyInput { body: string }`
  - kits: every kit extends `BaseKit`; `ListKit.rows`, `DetailKit.notices/body/history/editor`,
    `EditorKit.fields(parent)` (the slot the field rows render into), `FieldRowKit.textBox(parent)` (mounts the
    field's vim box, as Backlog's `EditorKit.textBox`), `RowKit.cursorActions(parent)`, `TaskDetailKit` with
    `editButton`, `pauseButton`, `runNowButton`, `removeButton` (each `(parent) => HTMLButtonElement`, the label and
    key anchor the app's), `PickerRowKit.trailing()`, `ConfirmBodyKit.keepButton/confirmButton`
- `default` layout `layout.js` (`// @ts-check` against `layout.d.ts`) defining every part, and its `layout.css`

Decisions:
- **Layout of the mode** (the user's pick, round 6): the task list is the mode's side bar, as Settings' sections and
  Practice's list are; the sheet holds the selected task's details and, under them, its history. The editor opens in
  the sheet in place of the details and history, as Backlog's editor opens in its detail pane. Reason: the side bar
  is where every mode keeps its list, and Alt+h / Alt+l and `focusSideBar` / `focusMain` then work with no new code.
- **Mode**: `api.modes.add({ id: 'main', title: 'Schedules', icon: 'calendar', … })`. `setContext` gives
  `{ title: 'Schedules', detail: <selected task's name> }`, null with no selection. `scheduling.showMode` shows the
  mode, or toggles its side bar while it shows (Backlog's `showMode`).
- **State source**: the page reads `schedulingStateSlot` and redraws on each change. A missing value draws as
  `{ tasks: [], fileError: null, fires: true, loginStart: null, runRows: [], unviewedRows: [] }`. A change keeps the
  selection by task id; a selected task that leaves selects the row at the same index, else the "+ New task" row. A
  change keeps an open editor's draft. Before task 17 lands no main part publishes the slot, so the mode shows the
  empty state; that is expected.
- **No place slot.** A page reload selects the first task and closes the editor. Reason: the settled design asks for
  no restore, and a draft lives only until saved or cancelled. `mayStop` refuses while the editor's draft changed,
  with the reason `The task editor has unsaved changes.`
- **Editor choices**: each editor open calls `channel.invoke('editorChoices')`. A rejection toasts
  `Could not open the editor: <reason>` and opens nothing.
- **Editor rows**, in this order. Labels pinned:
  1. `Name` — box.
  2. `Project` — box: a folder path (starts with `/` or `~`) or a pool project name. Its hint is
     `A folder path, or a pool project: <names joined by ", ">`; with no projects, `A folder path.`
  3. `Profile` — choice from `EditorChoices.profiles`.
  4. `Schedule` — choice: `Hourly`, `Daily`, `Weekdays`, `Weekly`, `Once`, `Cron`.
  5. By kind: Hourly → `Minute` box (hint `0 to 59`); Daily and Weekdays → `Time` box (hint `HH:MM, 24 h`); Weekly →
     `Day` choice (`Sunday` … `Saturday`, `day` 0 … 6) then `Time` box; Once → `Date and time` box (hint
     `YYYY-MM-DD HH:MM`); Cron → `Cron line` box (hint `Five fields: minute hour day month weekday`).
  6. One choice row per `EditorChoices.controls` entry, labelled with the control's `label`, its choices the
     control's choices' labels plus `Default` first. `Default` leaves the id out of `TaskDraft.controls`.
  7. `Prompt` — multi-line box.
- **Starting values.** A new task: `Name`, `Project` and `Prompt` empty; `Profile` the first of
  `EditorChoices.profiles` (chat's default profile is its first, as `start_session` defaults), empty when the list is
  empty; `Schedule` `Daily` with `Time` `09:00`; every control `Default`. An edited task: its own values. `Project`
  shows `projectDir` as the file stores it (a leading `~` kept) or the pool project's name. `fieldsOf` gives `at` in
  the `YYYY-MM-DD HH:MM` form the hint shows; `minute` as its decimal text. A control the task sets to a value that
  is not among the control's choices shows that raw value until the user picks again.
- **Editor keys**: `j` / `k` move the field cursor on the page; `Enter` or `i` on a box row focuses its box, on a
  choice row opens the list picker of its choices. `Tab` / `Shift+Tab` move between the boxes. `Esc` in a box leaves
  the box; `Esc` on the page cancels, asking the discard confirm when the draft changed (body
  `Discard the changes to this task?`). `Cmd+Enter` saves, from the page or a box.
- **`draftOf`** turns the editor's rows into a `TaskDraft` or a reason, checked in this order, first failure wins:
  `Name is empty.` · `Project is empty.` · `<value> is not a folder path or a pool project.` (a value with no leading
  `/` or `~` that `EditorChoices.projects` lacks) · `Choose a profile.` (the value is empty or not in
  `EditorChoices.profiles`: a profile deleted from chat's settings, or hand-edited, must be picked again) ·
  `scheduleOf`'s reason · `Prompt is empty.`
  Text is trimmed. `id` is the edited task's id, null for a new task; `paused` is the edited task's, false for a new
  one. A folder becomes `{ projectDir }`, a pool project `{ project }`.
- **`scheduleOf`**: builds the `TaskSchedule` of the kind from its fields, then runs `readSchedule` on it and
  returns its reason when it returns one. `minute` is parsed as a whole number; a non-number gives
  `Minute must be a whole number from 0 to 59.` `at` accepts `YYYY-MM-DD HH:MM` or `YYYY-MM-DDTHH:MM` and stores the
  `T` form. `fieldsOf(schedule)` then `scheduleOf` returns the same schedule for every kind.
- **Save**: `draftOf`'s reason shows as the editor's `problem` and nothing is sent. A valid draft goes to
  `channel.invoke('saveTask', draft)`; a resolve closes the editor, selects the returned id, toasts `Task saved`; a
  rejection shows its reason as `problem` and keeps the editor open.
- **List rows**: the "+ New task" row's label is `+ New task`. A task row shows the name, then `scheduleText`, then
  `next`: `Paused` when paused; else, while `fires`, `Next <when>` when `nextRun` is not null and `No next run` when
  it is null; while `fires` is false, `''`.
- **Times** show as local `YYYY-MM-DD HH:MM` (the form `scheduleText` uses for a one-time task), formatted in
  `schedules-state.ts` through `Date`'s local methods.
- **Details**: rows `Project` (the folder with the home folder as `~`, or the pool project's name), `Profile`,
  `Schedule` (`scheduleText`), `Next run` (`next` as in the list row), one row per control id the task sets, labelled
  with the matching `EditorChoices.controls` label when the choices are loaded, else with the id, then `Prompt`
  (the full text, wrapped). Buttons, in order: `Edit` (`scheduling.edit`), `Pause` or `Resume`
  (`scheduling.togglePaused`), `Run now` (`scheduling.runNow`), `Remove` (`scheduling.remove`, variant `danger`).
- **Actions**: `togglePaused` sends `setPaused(id, !paused)` and toasts `Task paused` or `Task resumed`; `runNow`
  sends `runNow(id)` and toasts `Run queued`; `remove` asks the confirm (body `Remove <name>?`, buttons `Keep it` /
  `Remove`) and on yes sends `removeTask(id)` and toasts `Task removed`. A rejection toasts `<reason>` in the error
  tone. These keys act on the selected task from the list and from the details; on the "+ New task" row they do
  nothing.
- **History** under the details, newest first, as `ScheduledTaskView.history` gives it, under the section header
  `History`. Each row: `when` is the entry's `occurrence` as a local time; `text` by outcome — `running` →
  `Running`, `finished` → `Finished`, `skipped` → `Skipped, previous run still going`, `failed` →
  `Failed to start: <reason>`. A row links (`linked` true) while its `rowId` is in `SchedulingState.runRows`: `Enter`
  or `l`, or a click, runs `sessions.activate(rowId)` (the `sessionsPageKey` export) and then the command
  `sessions.showMode` while Sessions mode is not shown. A row whose run row the user closed, or with a null `rowId`,
  draws unlinked. No history draws `No runs yet.` in `fg-tertiary`.
- **Notices** at the top of the details pane, each one line, in this order:
  - `fires` false: `This dev app shows and edits tasks but never runs them. The installed app runs them.` (`neutral`)
  - `fileError` not null: `scheduled-tasks.json has an error, so the list shows the last good tasks: <fileError>`
    (`error`)
  - `loginStart` `needsApproval`: `Tasks run after a restart once you allow Auri in Login Items: <detail>`, or
    the same line ending at `Login Items.` when `detail` is null (`warning`); `off` with a `detail`: `Login start failed: <detail>` (`error`); `unsupported`:
    `Tasks do not run after a restart until the app opens.` (`neutral`); `on`, or `off` with a null detail: none.
- **Env note** (the settled design: "Schedules mode says so"): the editor draws, under its rows,
  `A run gets only the app's own environment variables and PATH. Put any other variable in the profile's settings env.`
- **Empty state**: no tasks draws the EmptyState `No scheduled tasks.` with the `scheduling.newTask` key, in the
  details pane; the side bar still shows the "+ New task" row. With tasks, the "+ New task" row selected draws the
  EmptyState `Make a new scheduled task.` (reason `newTask`) with the same key, in place of the details and history.
- **Manifest** (12 adds to 03's): `dependsOn.page` includes `sessions`; settings `{ layout: 'default' }` with
  `settingInfo.layout` `{ label: 'Layout', description: "The Schedules layout: a folder name in scheduling's layouts
  folder, or default." }`; scopes `list: 'In the scheduled task list'`, `detail: 'In a scheduled task'`,
  `editor: 'In the task editor'`, `picker: 'In a task editor list picker'`, `confirm: 'In a task confirmation'`;
  commands, each `runsIn: 'page'`: `showMode` (`'schedules (again: toggle the side bar)'`, group `modes`), `listDown`,
  `listUp`, `listTop`, `listBottom`, `open`, `openKeepingFocus`, `newTask`, `edit`, `togglePaused`, `runNow`,
  `remove`, `historyDown`, `historyUp`, `historyTop`, `historyBottom`, `openRun`, `lineDown`, `lineUp`,
  `halfPageDown`, `halfPageUp`, `fieldDown`, `fieldUp`, `editField`, `nextField`, `previousField`, `save`,
  `cancelEdit`, `leaveBox`, `confirmYes`, `confirmNo`, `...LIST_PICKER_COMMANDS`, and the clicks `selectTask` and
  `openRunRow` (each `arg: 'string'`, no key). Labels are short verbs in Backlog's style.
- **Keys** (`src/plugins/keymap.ts`, a `// ── Schedules ──` banner section; `docs/keymap.md` § Adding a bind):
  - `<Leader>kt` scope `any` → `scheduling.showMode` (a mode goes under `k`; `t` for tasks; `kt` is free).
  - `<C-n>` → `chat.startNewSession` in `scheduling.list`, `scheduling.detail`, `scheduling.editor` (the per-view
    list).
  - `scheduling.list`: `j` `k` `gg` `G` (list moves; each move selects the row at once and the details follow it),
    `<CR>` `open` (moves focus to the details; on "+ New task" opens the new-task editor), `l` `openKeepingFocus`
    (as `open`, but focus stays in the list; on "+ New task" it does nothing), `a` `newTask`, `i` `edit`,
    `p` `togglePaused`, `r` `runNow`, `d` `remove`.
  - `scheduling.detail`: `j` `k` `gg` `G` (history cursor), `<CR>` and `l` `openRun`, `a`, `i`, `p`, `r`, `d` as
    in the list. Closing the editor (save or cancel) gives focus back to the pane that opened it.
  - `scheduling.list` and `scheduling.detail`: `<C-j>` `<C-k>` `<C-S-j>` `<C-S-k>` scroll the details pane.
  - `scheduling.editor`: `j` `fieldDown`, `k` `fieldUp`, `<CR>` and `i` `editField` (each `where: 'page'`),
    `<Tab>` `nextField`, `<S-Tab>` `previousField`, `<D-Enter>` `save`, `<Esc>` `leaveBox` (`where: 'box'`), `<Esc>`
    `cancelEdit` (`where: 'page'`).
  - `scheduling.picker`: `listPickerBinds('scheduling.picker')`. `scheduling.confirm`: `y` `confirmYes`, `n` and
    `<Esc>` `confirmNo`.
  - `r` run now and `p` pause in a new scope clash with no bind; this is a Decided notice, not a question.
- **Cursors**: with tasks, the first show selects the first task row, not "+ New task". The history cursor starts on
  the newest row each time the details pane takes focus.
- **Focus**: `focusSideBar` sets `scheduling.list` and focuses the list; `focusMain` gives the details
  (`scheduling.detail`) or the open editor (`scheduling.editor`) its scope and focus. `shown` sets the scope of the
  pane that held focus last, the list on the first show.
- **Page log lines** (through `services.log`, which prefixes `[scheduling]`; task 19 waits on them, so write them
  exactly): `mode shown: <n> tasks` on each `shown`; `task selected: <name>` (or `task selected: new` on the
  "+ New task" row) on each change of the selection, the first show's included; `details focused: <name>` each time `open` moves focus to the details; `editor opened: new` / `editor opened: <name>`; `editor closed` (on a cancel and after a save); `task saved: <name>`;
  `save refused: <reason>`; `paused: <name>`; `resumed: <name>`; `run now: <name>`; `removed: <name>`;
  `run row opened: <rowId>`; `state drawn: <n> tasks` after each redraw a slot change causes.
- **Layout contract text** is registered by the main part (`api.layouts.register({ layoutTypes })` with
  `../layouts/layout.d.ts?raw`, as `auto-retro/main/start.ts` does), which is task 17's. Until then the page draws the
  bundled `default`.
- **Look** (`DESIGN.md` § Surfaces, the new **Schedules** bullet, and the default layout): the side bar's rows are
  `row-list` rows, the name in `fg`, `scheduleText` and `next` under it in `fg-secondary`, `Paused` as a neutral Tag;
  the "+ New task" row's label in `fg-link`. The details pane is one sheet: notices as one-line Cards in their tone,
  the task's name as a heading, the field rows as label (`fg-secondary`) and value (`fg`) pairs, the prompt in
  `font-mono` wrapped, the four buttons in one row, then the `History` SectionHeader over `row-list` rows (`when` in
  tabular numerals, `text` in `status-success` for Finished, `status-warning` for Skipped, `status-error` for Failed,
  `status-running` for Running, a linked row's text also `fg-link`). The editor follows Settings' rows: each a label
  and its value or box in an InputFrame, the hint under it in `fg-tertiary`, the problem in `status-error`.

GIVEN a state with two tasks, one paused WHEN the mode shows THEN the side bar lists `+ New task`, then each task with
its `scheduleText` and `Next 2026-11-20 14:30` or `Paused`
GIVEN the editor's rows with an empty name WHEN `save` runs THEN the problem reads `Name is empty.` and no
`saveTask` is sent
GIVEN a weekly schedule WHEN `fieldsOf` then `scheduleOf` run THEN the result equals the schedule
GIVEN a history entry whose `rowId` is in `runRows` WHEN `openRun` runs on it THEN `sessions.activate` gets that id
GIVEN `fires` false WHEN the details draw THEN the dev notice shows and task rows show no next run

Tests:
- `src/plugins/scheduling/page/schedule-fields.test.ts`, `describe('scheduleOf')`:
  - `it.each` round trip, one row per kind (`{ kind: 'hourly', minute: 15 }`, `{ kind: 'daily', time: '09:00' }`,
    `{ kind: 'weekdays', time: '07:30' }`, `{ kind: 'weekly', day: 3, time: '18:45' }`,
    `{ kind: 'once', at: '2026-11-20T14:30' }`, `{ kind: 'cron', line: '0 9 * * 1-5' }`): `scheduleOf(fieldsOf(s))`
    equals `s`. Catches a field written to the wrong row of the editor.
  - `it.each` refusals: minute `'x'` → `Minute must be a whole number from 0 to 59.`; once `'2026-11-20 14:30'` →
    `{ kind: 'once', at: '2026-11-20T14:30' }`; a time `'25:00'` → a string (readSchedule's reason, asserted as
    `typeof` string and containing `time`). Catches the page passing a bad schedule to main.
- `src/plugins/scheduling/page/schedules-state.test.ts`:
  - `draftOf` table: one valid editor builder, one field varied per row, each row's literal expected reason in the
    pinned order, plus a valid folder row → `{ projectDir: '~/dev/app' }` and a pool row → `{ project: 'games' }`;
    a profile not in `EditorChoices.profiles` → `Choose a profile.`; a control at `Default` → its id absent from
    `controls`; a control picked → `{ <id>: <value> }` in `controls`.
  - new-task draft: the starting values above, `Profile` the first of `EditorChoices.profiles`.
  - editor across a state change: an open editor's changed draft is the same after a slot change.
  - cancel: a changed draft asks the confirm with body `Discard the changes to this task?`; an unchanged draft closes
    with no confirm.
  - list rows table over a `SchedulingState` builder: paused → `Paused`; active with `nextRun` → `Next <local time>`;
    active with null → `No next run`; `fires` false → `''`. Set `process.env.TZ` to `America/New_York` for the file and
    restore it (plan.md § Decisions, Local time through `Date`).
  - history text table: one row per `RunOutcome`, the literal pinned text; `linked` true only when `rowId` is in
    `runRows`.
  - notices table: each `fires` / `fileError` / `loginStart` case → the pinned notices in order, `needsApproval` with
    a null `detail` included.
  - selection: a state change that drops the selected task selects the row at the same index; one that keeps it keeps
    it; the "+ New task" row selected with tasks gives the `newTask` empty state.
- `src/plugins/scheduling/page/start.test.ts` (`startDrawingPagePart`, one case per wiring, the rules' cases stay in
  the state tests):
  - the slot's value draws one task row per task under the `+ New task` row.
  - `save` with a valid editor sends `saveTask` with the `TaskDraft` and logs `task saved: <name>`; a rejected
    `saveTask` keeps the editor open with the reason.
  - `openRun` on a linked history row calls the fake sessions page export's `activate` with the row id.
  - `mayStop` refuses with a changed draft.
- `src/shared/layouts/layout-contracts.test.ts` picks up the new `layout.d.ts` with no edit (it reads every owner's);
  confirm it type-checks.

Done when: `npm run lint` and `npm run typecheck` exit 0; the test gate runs the tests above; the keymap check accepts
`<Leader>kt` and the new scopes. The live look and keys are checked in task 21 (Final verification) and through task
19's self-test.

Commit: one commit for the group — "Add Schedules mode: task list, details, history and editor drawn through the
scheduling layout".

## Proof
