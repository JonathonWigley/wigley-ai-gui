# 09 — Doc re-read

Status: not started
Type: Task
Wave: 9 · Depends on: 01–08
Plan: [plan.md](plan.md)

Files:     modify only where a line below is untrue of the landed code: `docs/keymap.md`, `AGENTS.md`, `DESIGN.md`,
           `docs/features/chat-bar/design.md`
Consumes:  the landed code of Tasks 01–08
Produces:  docs true of the code; no code change
Decisions: the docs were written ahead (commits `eae58c69`, `586eb976`, `09552297`) from the settled design; this task fixes
           each line the implementation moved away from, and never moves code to match a doc (a doc that names
           behaviour the code lacks is a missed task item: report it to the lead instead of writing it out)

## What to re-read

Read `git show eae58c69 586eb976 09552297` for the lines written ahead, then check each against the code and the keymap
(`src/plugins/keymap.ts`), one claim at a time, batched per `~/wigley-agents/AGENTS.md` § Tools:

- `docs/keymap.md` § Layers:
  - the Alt+hjkl paragraph: every view's own pane named (Docs session tab tree/doc, doc and right column, Backlog
    list/detail, primer columns, Chat tab transcript/box/hub), the side-bar list per mode, the right bar's Alt+j/k,
    Alt+l/Alt+h back to main's last pane, a hidden bar being no stop, the DOM focus moving.
  - the side-bar list bullet: `Enter` and `l` in all four lists (Settings `l` is `settings.openKeepingFocus`, Task 05),
    the Sessions row keys `s`, `J`/`K`, `r`, `d`, `Esc` (Task 03).
  - the picker bullet against `LIST_PICKER_COMMANDS` and `listPickerBinds` (Task 08).
  - the scroll-or-rows bullet: every pane named takes `gg`/`G` and `j`/`k`; the doc's right column takes `Enter`/`l`
    and `Esc` (Task 04); the hub's section heads (Task 06).
  - the Ctrl+n view list against the `<C-n>` per-scope list in `keymap.ts` (new: `sessions.sidebar`, `chat.hub`,
    `docs.aside`, `backlog.homes` if Task 05 added it there).
  - the Ctrl+j/k view list: the session hub, an open agent-strip box's tool list (Task 07), the key help (Task 08).
  - line 48's chat `y`/`n` clause (Task 07).
  - the resize paragraph's hub entry, "while the hub has the keys" (Task 06; `09552297`).
- `DESIGN.md` § Splits line and `docs/features/chat-bar/design.md` § Width: the hub by drag and Alt+Shift+h/l while it
  has the keys (`09552297`).
- `docs/keymap.md` leader table: the `c` row's `ci` on the page and in a box (Task 07).
- `AGENTS.md` § Architecture:
  - the mode bullet: `focusSideBar` and `focusMain` as `src/contracts/plugin.ts` documents them (Task 01).
  - the focus-target bullet: the areas, `baseChanged`, the right bar's first stop, Alt+j/k, `focusMain` back, the
    overlay case through `sideBarOpened` (Task 01).
  - the right bar line: a contribution's `focus` through `RightBarOptions` (Tasks 01, 02).
  - the side-part line: the hub as chat's own pane, its section-head cursor, Enter or `l` folding, the drag and
    Alt+Shift+h/l sizing (Task 06).
  - the plugin tree's `unity-pool/` entry: add the panel's cursor keys only if the entry lists other plugins' keys
    in the same way at the time of reading; otherwise leave it.
- `DESIGN.md` § Keys and focus: the Sessions list in the cursor prompt list; the selected card keeping its hidden
  prompt line (Task 03's decision) agrees with the "hides in place, keeping its space" rule.
- `docs/features/followups.md`: the entry "Pane focus keys leave the keyboard in the old pane" is gone (Task 03).

Every line fixed is listed in the commit message with the task whose code moved it.

Done when: every claim above is checked, each untrue line is fixed, and a missed task item, if any, is reported to the
lead rather than written out; `npm run lint` passes.
Commit:    one commit, `docs:` scope, or none when no line needed a change (say so in the report)

## Proof
