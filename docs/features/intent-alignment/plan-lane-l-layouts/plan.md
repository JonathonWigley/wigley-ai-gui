# Lane L: layouts everywhere — plan

Feature: intent-alignment · Implements: none · Ticket: none
Target: main · Written: 2026-11-09 · Revised: 2026-11-16 (Backlog rebuilt, the audio picker joins; § Decisions, round 2)

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Every surface Lane L names in `docs/features/intent-alignment/master-plan.md` § Lane L draws through its owner's
layout, so a layout file changes its look with no rebuild, and a layout reload keeps the user's place:

- toasts through the shell layout, with the shell layout swap failure tests
- every dialog's frame through its opener's layout, and the forms, primer and audio picker cancel confirms' bodies
- forms' and the primer's column chrome (rail head, item pager, rail foot; column heads, tasks foot, card edge strip,
  review footer)
- fixed texts in layout slots: backlog's and docs' status text, every cursor-row prompt (backlog, docs, settings,
  primer, notes, sessions, chat's picker), the settings edit box message
- the sessions split picker's rows through the sessions layout
- a layout reload keeps every text box (text, cursor, vim mode, undo), redraws only the parts whose layout changed,
  and a `layout.css`-only save re-links the stylesheet with no redraw

## Architecture

Systems touched: the shell chrome and toasts (`src/renderer/shell/`, `src/renderer/toasts.ts`), the shared dialog and
confirm prompt (`src/shared/page/ui/dialog.ts`, `src/shared/page/confirm-prompt.ts`), the shared kit types
(`src/shared/page/layout-host/kit.d.ts`), the shared editor boxes (`src/shared/page/editor-boxes.ts`), the layout
registry and loader (`src/shared/layouts/layout-registry.ts`, `src/contracts/layouts.ts`,
`src/shared/page/layout-host/layout-loader.ts`), and the layout contracts, `default` layouts, readers and views of
the owners shell, sessions, chat, docs, notes, practice, backlog, keys, session-stash, gallery, settings, primer,
audio-picker and forms.

Every change follows one rule the codebase already holds for the sessions popup: the layout draws a surface's frame
and contents, and the app keeps its lifecycle (show and hide, keys and scope, focus, timing, removal) and the state
marks it sets on the root the layout returns. A button a layout draws goes through `kit.button`, which runs a command;
no closure button.

### Gate: Lane E's forms chain

Tasks 11, 12 and 13 edit `src/plugins/forms/`, which Lane E's forms chain rewrites first (master-plan.md § Intent,
Side lanes). `wigley:make` starts Wave 5 only once the gate check below prints three lines; until then the run stops
after Wave 4 and reports the gate as the reason. Waves 1–4 run beside the other lanes. Before it stops at the gate,
the run runs task 15's **Block A** (the live checks of tasks 01–10) and records them in task 15's Proof, so the
items Waves 1–4 tick are proved live without waiting for the gate; Block B runs once Wave 8 lands.

```
command grep -n '\[x\] Forms item kinds as registrations\|\[x\] Finding origin specs and open layout unions\|\[x\] Split form-state.ts and rename the FormsView union' <repo>/docs/features/intent-alignment/master-plan.md
```

Tasks 11–13 are written against the forms code as it stood at plan time. Lane E renames the `FormsView` union, turns
the card tables into kind registrations and opens the layout unions to strings, so the implementer of each gated task
first re-reads its Files against the tree and follows Lane E's names; the decisions in the task hold as written.

## Preconditions

Re-run by `wigley:make` before the first dispatch (`<repo>` is the wigley-ai-gui folder of the clone or worktree the run works in):

1. The docs written ahead are on the target: `git -C <repo> log --oneline --grep 'Lane L docs ahead' main` prints
   one line.
2. The seven Lane L follow-ups are still open:
   `command grep -c '^- \*\*Toasts through the shell layout\*\*\|^- \*\*Dialog frames and confirms through the opener.s layout\*\*\|^- \*\*Forms and primer column chrome through their layouts\*\*\|^- \*\*Fixed texts in layout slots\*\*\|^- \*\*Sessions split picker rows through the sessions layout\*\*\|^- \*\*Layout hot reload keeps the user.s place\*\*\|^- \*\*Shell layout swap failure tests\*\*' <repo>/docs/features/followups.md`
   prints `7`.
3. `createDialog`'s callers outside tests are the eleven task 07 and 11 name (measured at plan time, re-verify):
   `command grep -rn 'createDialog(' <repo>/src --include='*.ts' | command grep -v '\.test\.ts' | command grep -v 'ui/dialog.ts'`
   prints `chat-dialogs.ts`, `gallery-view.ts`, `docs-dialogs.ts` (two), `rename-dialog.ts`, `popup.ts` (two, notes),
   `help-view.ts`, `import-box.ts`, `note-dialog.ts` and `confirm-prompt.ts`. A new caller joins task 07 as a row.
4. `createStatusLine` has two callers, forms' `round-view.ts` and the primer's `primer-view.ts`:
   `command grep -rlw 'createStatusLine' <repo>/src --include='*.ts' | command grep -v '\.test\.ts'` prints those two
   and `status-line.ts`.
5. `createConfirmPrompt` has four callers, forms' `forms-view.ts`, the primer's `primer-view.ts`, practice's
   `problem-workspace.ts` and the audio picker's `picker-view.ts` (measured 2026-11-16, re-verify):
   `command grep -rlw 'createConfirmPrompt' <repo>/src --include='*.ts' | command grep -v '\.test\.ts'` prints those
   four and `confirm-prompt.ts`. A new caller outside forms joins task 07 as a row.
6. Editor boxes have four owners, forms, the primer, practice and the audio picker (measured 2026-11-16, re-verify):
   `command grep -rlE 'createEditorBoxes|boxes\.mount\(' <repo>/src/plugins --include='*.ts' | command grep -v '\.test\.ts'`
   prints `forms/page/start.ts`, `forms/page/round-view.ts`, `primer/page/start.ts`,
   `primer/page/layout/primer-kit.ts`, `practice/page/problem-workspace.ts`, `audio-picker/page/start.ts` and
   `audio-picker/page/layout/picker-kit.ts`. A new owner outside forms joins task 10 as a section.
7. Gate for Wave 5 only: the command in § Gate prints three lines.

## Docs written ahead

Commit `204d990b5` ("Lane L docs ahead: …"): `AGENTS.md` (the shell line in Architecture), `DESIGN.md` (the Dialog
primitive), `docs/features/layouts/design.md` (§ Live defaults Reload, § What a layout draws, the shell and sessions
Adopters rows, § The primer's columns, § Decisions: a reload keeps the user's place, a dialog follows its opener).

The forms-only lines of `AGENTS.md` § A forms layout (what the app keeps: "the rail header's open count and saved
state, and the cancel dialog"; **Reloads**) are not written ahead: they change in the gated tasks 11–13, whose code
cannot land before Lane E's chain, so `main` keeps describing forms as it is until then.

## Mandatory Reads

- `AGENTS.md` (the wigley-ai-gui folder's) — every implementer reads § Intent, § Architecture's bullets **A layout**, **A key**,
  **Key hints**, **A list picker draws a layout's rows**, `npm run lint`'s layer check, § Review and § Running and
  testing; the forms tasks also **A forms layout** and **An item kind**.
- `DESIGN.md` — § Keys and focus and the primitive the task touches.
- `docs/features/layouts/design.md` — whole.
- `docs/keymap.md` — only for task 07's keys help Close and any task that anchors a new key.
- No `CLAUDE*.md` or `.claude/rules/*.md` exists in the wigley-ai-gui folder (`find <repo> -maxdepth 1 -name 'CLAUDE*.md'` and `ls -d <repo>/.claude/rules` find none,
  checked at plan time).

## Design Overview

```
 layout reload (user saves a layout file)
   registry: .js/.mjs/data → revision+1        any .css only → styleRevision+1
             images, fonts, a layout joining or leaving, a whole folder renamed, moved or deleted,
             a missed-watch rescan that finds mixed kinds → both (task 05)
        │                                             │
   loader: re-import module ─► new layout object      re-link stylesheet only ─► no setLayouts, no redraw
        │
   owner setLayouts: compare each part's pick ─► redraw only parts whose pick changed
        │
   editor boxes: each box's frame owned by editor-boxes, moved into the redrawn part (place);
                 a draw that leaves a box out releases it; destroy only when its form or field ends

 a surface the app opens (dialog, confirm, toast)
   app ─► owner's layout part draws frame (dialogFrame / confirmBody / toast) ─► returns root (+ body, actions)
   app keeps: scrim, show/hide, keys, focus return, tone/role marks, fade, timing, removal

 fixed text and chrome
   app computes strings + raw numbers + shown prompt actions ─► part input ─► layout draws
   app keeps: the save status element (kit.saveStatus), is-no-target and selection marks, key anchors via kit.keyHint
              (marks through kit members such as primer rowStep, forms itemEdge; notes passes hasTarget as input)
```

### Decisions

Round 1 (all recommendations taken):

- **Every dialog gets the frame hook**, all openers in this plan, not only the three the follow-up names.
- **The layout draws a dialog's whole frame** — panel, title, actions row — returning its body and actions for the
  app to fill; the app keeps the scrim, show and hide, Esc and scope, and focus return (as the sessions `popup` part).
- **The layout draws the whole toast**; the core sets `data-tone` and `role=status` on the returned root, fades it in
  with `openFloatingPanel`, and removes it after `TOAST_MS` (4000).
- **A part per chrome strip**: forms `railHead`, `railFoot`, `pager`; primer `tasksHead`, `itemsHead`, `tasksFoot`,
  `cardEdge`, `reviewFooter`, each with its own input, picked like the other panes. Inputs carry the app's strings and
  the raw numbers; the save status is a kit element the app keeps current (`kit.saveStatus`).
- **Cursor prompts as input**: the shown actions as `{ command, label }` pairs, each drawn with `kit.keyHint`.
- **Settings box message** is a part the layout draws into a slot the app keeps, redrawn when the message changes; the
  editor box stays the app's.

Notices sent in round 1 (Decided):

- Only tasks touching `src/plugins/forms/` or `src/shared/agent-forms/` wait for Lane E's chain (§ Gate).
- Sessions' row prompt and chat's picker `cursorEnd` join the fixed-texts item.
- The primer's review footer joins the column chrome item.
- Sessions split picker rows mirror chat's `pickerRow` (input says session or New session; kit hands `trailing`).
- Shared dialog frame, confirm buttons and prompt action types live once in the shared kit. One exception the code
  forces: `npm run lint`'s layer check bars `src/shared/page` and `src/shared/page/ui` from importing `layout-host`,
  type-only imports included, so `dialog.ts` declares `DialogFrameInput` and `DialogFramePart` again and
  `layout-host/dialog-frame.test-d.ts` fails if the copies drift (task 04).
- Shell swap failure tests: one table over three failures.

Headless picks (the user handed the session over in round 1's note; listed in the hand-off as Decided):

- **A reload keeps boxes, not snapshots.** Editor boxes own each box's frame and move it into the redrawn part, as
  chat's composer does, keeping cursor, vim mode and undo for every box; `TextEditor` gains no `snapshot`/`restore`.
  It covers every `keepFocusedBox` caller: forms, primer, practice, audio picker (round 2).
- **A style-only save re-links with no redraw**: the registry raises a separate `styleRevision` when only
  `layout.css` changed; the loader keys the stylesheet by it and the module by `revision`.
- **Per-part redraw by pick compare**; `LayoutSet.changed`, unread outside tests, is removed from the contract.
- **`drawFrame` becomes required** in task 11, once every opener passes one, and the code-built frame is deleted.
- **Lane bookkeeping**: ticking master-plan.md boxes and removing follow-ups rides in the one task of each wave that
  closes an item (10 for Toasts, swap tests, the sessions picker and Fixed texts; 11, 12, 13 for their own items), since
  two groups of one wave cannot share those files.
- **Gated docs**: the forms-only AGENTS.md lines change in tasks 11–13, not ahead (§ Docs written ahead).

Drafting picks (headless; each drafter's open question, settled on its recommendation):

- **Toasts**: `ShellKit` gains `floatingPanel(parent)`, as chat's composer kit has, so a layout never hard-codes
  `ui-floating` (task 01).
- **Rows kept across a cursor move** (settings, its Leader menu, notes): a `cursorPrompt` part `{ actions }` drawn
  into the slot the app keeps on the cursor row, so a move redraws only the prompt and a focused box stays put. Rows
  that redraw on a move (backlog, docs, sessions, chat's picker) take `prompt` on their row input (task 08).
- **Notes' dimmed hint**: `NotesPromptActionInput extends PromptActionInput { hasTarget: boolean }`; the layout adds
  `is-no-target`, keeping today's look (task 08).
- **Removed kit members** (`cursorActions`, `cursorPrompt`, `cursorEnd`): a user
  layout calling one throws and that part falls back to `default`, the host's per-part rule (task 08).
- **Strip inputs** carry the app's strings and raw counts; button copy is the default layout's (tasks 09, 12). A head
  that leaves out `saveStatus` still gets it, placed where its default draws it (`placeIfLeftOut`). A primer column
  part that draws no row prompt shows none.
- **`dialog.css` keeps every rule** (the primitive's classes every default frame draws with); only keys' help-dialog
  width rule moves to keys' default `layout.css`. Keys' Close draws `kit.button` plus `kit.keyHint`, so its hint
  follows a rebind (task 07).
- **`keepFocusedBox` stays** in every owner: the sweep of released boxes and the refocus run after the whole draw
  (tasks 06, 10, 13).

Design review (headless):

- Keeps as is: the layout host's per-part fallback to `default`; `appSlot`'s place / place-if-left-out pattern for
  app elements (the save status, the settings message slot, the box frames); `kit.button` over commands.
- The confirm prompt's `drawBody` stays; its frame comes through the same `drawFrame` the opener passes.
- `createToasts` takes its draw (`drawToast`) and a `log` as parameters, so it names no layout, logs a draw that throws, and tests hand it fakes.
- Out of scope, tracked elsewhere: Lane E's kind registrations and open unions (they reshape the forms files the gated
  tasks touch); the Layout name picker (Lane E).

Round 2, 2026-11-16 (a refresh against main found two owners changed under the plan; both recommendations taken):

- **Backlog stays, redesigned.** Its rebuild (ai commit `ba762a069`) left it no dialogs, confirm prompts or editor
  boxes, so it leaves tasks 06, 07, 10 and 15's dialog and box work; its status text and cursor-row prompt still draw
  through its layout (task 08's backlog row, rewritten).
- **The audio picker joins the ungated waves.** Its cancel confirm's frame and body draw through its layout (task 07,
  Wave 2) and its notes boxes are kept across a reload (task 10, Wave 4), so task 11's required `drawFrame` and task
  13's deletion of `mount` hold. Tasks 06, 13 and 15 name it. Its code is outside `src/plugins/forms/`, so it does
  not wait on the gate.

Decided in the revision:

- Backlog's prompt is row input, not a `cursorPrompt` part: its rows draw again on every render. (The round's notice
  said the rows were kept across a cursor move; the code says otherwise.)
- Backlog's status is a `tableStatus` part drawn into a slot the app keeps, as docs' `treeStatus`.
- `EditorBoxes.setText` is dropped from task 06: its only caller was backlog's tags picker, which the rebuild removed.
- The audio picker's prompt parts draw with a `createConfirmKit` beside `createPickerKit`, scope
  `audio-picker.confirm`; its `confirmBody` returns `PickerLayoutPart`, the shape every audio picker part returns.

### Out of scope

- Restyling primitives app-wide from a layout (themes carry it).
- `TextEditor.snapshot`/`restore` (rejected above).
- Lane E's forms chain and every other lane's items.

## File Structure

Shared names more than one task uses (each task's Produces gives the exact signature):

- `src/shared/page/layout-host/kit.d.ts` (task 04):
  - `interface DialogFrameInput { title: string; hasActions: boolean }`
  - `interface DialogFramePart { element: HTMLElement; body: HTMLElement; actions: HTMLElement | null }` — `body`
    and `actions` are descendants of `element`; `actions` is null exactly when `hasActions` is false
  - `interface ConfirmButtonsKit { keepButton(parent: HTMLElement): HTMLButtonElement; confirmButton(parent: HTMLElement): HTMLButtonElement }`
    — each owner's `ConfirmBodyKit` extends its own kit and this
  - `interface PromptActionInput { command: string; label: string }` — a cursor-row prompt's shown action, `command`
    a qualified id
- `src/shared/page/ui/dialog.ts` (task 04): `type DrawDialogFrame = (parent: HTMLElement, input: DialogFrameInput) => DialogFramePart`;
  `DialogOptions.drawFrame?: DrawDialogFrame` (required from task 11); `Dialog.redrawFrame(): void`;
  `Dialog.panel`, `body` and `actions` become getters (a redraw replaces them, so read them on each use); its own
  copies of `DialogFrameInput` and `DialogFramePart` (§ Decisions)
- `src/shared/page/layout-host/draw-part.ts` (task 04):
  `requireDialogFrame(frame: unknown, input: DialogFrameInput, partName: string): DialogFramePart` — every owner's
  `dialogFrame` build calls it (tasks 07, 11), so a bad frame throws and the host draws `default`
- `src/shared/page/confirm-prompt.ts` (task 04): `ConfirmPromptDeps.drawFrame?: DrawDialogFrame`, passed to its
  dialog (required from task 11); `ConfirmPrompt.redraw()` also redraws the frame
- every owner contract that opens a dialog (tasks 07, 11): a part
  `dialogFrame?(parent: HTMLElement, input: DialogFrameInput, kit: <Owner>Kit): DialogFramePart`
- `src/shared/page/editor-boxes.ts` (task 06): `EditorBoxes.place(parent: HTMLElement, box: Box, text: string): HTMLElement`
  and `EditorBoxes.release(box: Box): void`, `destroyReleased(formId: string): void` (ends the boxes a redraw left
  out; `keepFocusedBox` runs it); `mount` stays until task 13 deletes it
  (task 06 gives the full contract; tasks 10 and 13 consume it)
- `src/contracts/list-picker.ts` (task 08): `DrawRowInput.isCursor: boolean`, set by `list-picker.ts` `drawRowAt`
- the save status (tasks 09, 12): a per-owner kit member `saveStatus(parent): HTMLElement` (primer
  `TasksHeadKit.saveStatus`, forms `RailHeadKit.saveStatus`) over one `createStatusLine()` per view, placed through
  `appSlot`; not in the shared `kit.d.ts`
- `src/contracts/layouts.ts` (task 05): `LayoutEntry.styleRevision: number`; `LayoutSet.changed` removed

Existing files modified, by task: each task document's Files line. New files: none planned beyond tests a task names;
a task that needs a new module names it with its reason.

Boundary rules: `src/shared/page/**` names no owner; a plugin imports only what `npm run lint`'s layer check allows;
every layout part's root carries the host's `data-layout` attributes (the host stamps them); a `default` layout defines
every part its contract adds.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [ ] [Toasts through the shell layout](01-toast-part.md)
- [ ] [Shell layout swap failure tests](02-shell-swap-failure-tests.md)
- [ ] [Sessions split picker rows](03-sessions-picker-rows.md)
- [ ] [Dialog frame hook and shared kit types](04-dialog-frame-hook.md)
- [ ] [Style-only layout reload](05-style-only-reload.md)
- [ ] [Editor boxes kept across a redraw](06-editor-boxes-keep.md)

### Wave 2
- [ ] [Dialog frames through each opener's layout](07-dialog-frames.md) — after 03, 04

### Wave 3
- [ ] [Fixed texts in layout slots](08-fixed-texts.md) — after 04, 07
- [ ] [Primer column chrome and cursor prompt](09-primer-chrome.md) — after 04, 07

### Wave 4
- [ ] [Primer, practice and the audio picker keep their boxes](10-boxes-kept-primer-practice-audio-picker.md) — after 06, 08, 09

### Wave 5 — gate: Lane E's forms chain (§ Gate)
- [ ] [Forms dialog frame and cancel confirm](11-forms-dialog-confirm.md) — after 07, 10

### Wave 6
- [ ] [Forms column chrome](12-forms-chrome.md) — after 11

### Wave 7
- [ ] [Forms keeps its boxes and redraws only changed parts](13-forms-boxes-and-part-redraw.md) — after 05, 06, 12

### Wave 8
- [ ] [Doc re-read](14-doc-re-read.md) — after 13

### Wave 9
- [ ] [Final verification](15-final-verification.md) — after 14

## Run log

Review base: <sha, written by wigley:make at preflight>

### Groups
### Contract changes
### Rulings
### Review rounds
### Test gate
