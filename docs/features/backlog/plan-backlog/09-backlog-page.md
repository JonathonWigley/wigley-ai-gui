# 09 — Backlog page part

Status: not started
Type: Task
Wave: 4 · Depends on: 08
Plan: [plan.md](plan.md)

Files:     create `src/plugins/backlog/page/start.ts` · create `src/plugins/backlog/page/backlog-state.ts` +
           `backlog-state.test.ts` · create `src/plugins/backlog/page/backlog-view.ts` · create
           `src/plugins/backlog/page/followup-editor.ts` · create `src/plugins/backlog/page/backlog.css` · modify
           `src/plugins/page.ts` (append `backlogPagePart`) · modify `src/plugins/keymap.ts` (a Backlog banner section
           and the `<Leader>kb`, `<Leader>vd`, `<Leader>va` binds) · modify `scripts/check-layers.mts` (a
           `src/plugins/backlog/page` entry shaped as docs' page entry; may import `src/plugins/docs/contract.ts`,
           `src/plugins/keys/contract.ts`, `src/shared/page`, `src/shared/page/ui`, `src/shared/followups`)
Consumes:  `backlogManifest`, `BacklogChannel`, `BacklogRead`, `BacklogHome`, `BacklogWriteResult`, message `changed`
           ← 08 · `FollowupItem`, `FollowupDraft`, `FollowupEdit` ← 01 · existing: `DocsPageExports.openDoc`, the `keys`
           page exports `keysFor`/`onChanged`, `createConfirmPrompt` (`src/shared/page/confirm-prompt.ts`),
           `createListPicker` (`src/shared/page/list-picker.ts`), `createEditorBoxes` (`src/shared/page/editor-boxes.ts`),
           `textBoxInput` (`src/shared/page/text-box.ts`), page services `markdown`, `editor`, `uiState`, `toast`
Produces:  `backlogPagePart` in `src/plugins/backlog/page/start.ts`
           a pure reducer in `backlog-state.ts`: `export function backlogReducer(state: BacklogState, action: BacklogAction): BacklogState`
           and `export function visibleRows(state: BacklogState): BacklogRow[]` (types internal to the page part)
Decisions: the layout, keys and behaviours in design.md § The mode, § Follow-ups, § Plans and features (rounds 1–2) ·
           Settings mode is the model to copy for a mode with a side bar, a content sheet and editor boxes
           (`src/plugins/settings/page/`) · every key hint is drawn by the Kbd primitive from `keysFor`
           (AGENTS.md § Key hints) · every value in CSS is a token (DESIGN.md § Tokens and themes; `check-styles.mts`
           enforces it) · selection, filters and the done / agent-ready-only toggles live in the reducer, so the view
           draws state and holds no decisions

## The mode

- Title "Backlog", Codicon `checklist`. `<Leader>kb` shows it; pressed while shown, toggles the side bar, as
  `docs.showMode` does. The narrow-window overlay and `picked()` follow AGENTS.md § A mode.
- Side bar: one row per repo, its homes under it (`~`-shown root, an uncommitted Tag when `uncommitted`). Enter or `l`
  opens a home into the content sheet and moves focus to its list. The side bar has no scope of its own: the reducer
  holds `focus: 'homes' | 'items' | 'detail'`, and the `backlog.list` commands act on the focused one of `homes` and
  `items`. `h` (`back`) from `items` returns focus to `homes`, opening the side bar when it is hidden.
- Content sheet, a Split (ui primitive) of list and detail:
  - List: section headers "Follow-ups", "Plans", "Features". A follow-up row shows its title, its tags as Tags
    (`agent-ready` in the accent tone, others neutral) and its one line. A plan row shows title, feature,
    `checked/total`, target. A feature row shows slug and `checked/total`. Done follow-ups hidden unless toggled.
  - A plan or feature row has its task documents as child rows under it, collapsed; `<CR>` (`toggle`) expands or
    collapses them, and `j`/`k` move through them like any row.
  - Detail: the selected follow-up's title, tags, one line and body rendered through `services.markdown`; a selected
    plan, feature or task row renders its file (`plan.md`, `checklist.md` or the task doc) from `readDoc`.
    `openInDocs` (key `o` in `backlog.list` and `backlog.detail`) calls `openDoc(path, line)` on the selected row.
- Status bar text when empty: "No features homes found" or the load's `message`.

## Keys (`src/plugins/keymap.ts`, Backlog banner)

`where` is the keymap entry's field (`page`, `box`, `both`); blank means the default (AGENTS.md § A key).

| Keys | Scope | where | Command |
|---|---|---|---|
| `<Leader>kb` | `any` | | `backlog.showMode` |
| `<Leader>vd` | `any` | | `backlog.toggleDone` |
| `<Leader>va` | `any` | | `backlog.toggleAgentReadyOnly` |
| `j` `k` `gg` `G` | `backlog.list` | | `listDown` `listUp` `listTop` `listBottom` |
| `l` / `<CR>` / `h` | `backlog.list` | | `open` / `toggle` / `back` |
| `/` `a` `i` `d` `t` `T` `C` `R` `o` | `backlog.list` | | `filter` `create` `edit` `delete` `toggleAgentReady` `pickTag` `commit` `rescan` `openInDocs` |
| `<A-l>` / `<A-h>` | `backlog.list` / `backlog.detail` | | `focusDetail` / `focusList` |
| `<C-j>` `<C-k>` `<C-S-j>` `<C-S-k>` | `backlog.list` and `backlog.detail` | | `lineDown` `lineUp` `halfPageDown` `halfPageUp` (scroll the detail) |
| `j` / `k` / `o` | `backlog.detail` | | `lineDown` / `lineUp` / `openInDocs` |
| `<D-CR>` | `backlog.editor` | `both` | `save` |
| `<Esc>` | `backlog.editor` | `box` | `leaveBox` (normal mode leaves the box) |
| `<Esc>` | `backlog.editor` | `page` | `cancelEdit` |
| `<C-n>` / `<C-p>` | `backlog.editor` | `both` | `nextField` / `previousField` |
| `T` | `backlog.editor` | `page` | `pickTag` (on the draft's tags; inside a box `T` stays vim's) |
| `<CR>` / `<Esc>` | `backlog.box` | | `boxAccept` / `boxCancel` (the `/` filter box) |
| `y` / `n` / `<Esc>` | `backlog.confirm` | | `confirmYes` / `confirmNo` / `confirmNo` |
| `j` `k` `<CR>` `l` `<Esc>` | `backlog.picker` | | the picker commands |

Copy the `where` usage from `docs.quitEditor` and forms' box binds in `src/plugins/keymap.ts`.

Run every bind through `docs/keymap.md` § Adding a bind step 3; the startup check fails on a clash. `<Leader>kb`,
`vd`, `va` are free (checked at plan time against `src/plugins/keymap.ts`).

## Flows

- `create` (`a`): opens the editor empty in the detail pane; save sends `applyEdit(createTargetRoot, null, { type:
  'create', draft })`. A repo with no create target (cannot happen: `groupHomes` gives one per repo) needs no branch.
- `edit` (`i`): the editor filled from the item; save sends `{ type: 'edit', title: <original title>, draft }`.
- Editor: four vim boxes through `createEditorBoxes` and `services.editor`: Title, One line, Tags (comma-separated)
  and Body (multi-line); the first three take one line. `Ctrl+n`/`Ctrl+p` move between them. `Cmd+Enter` saves.
  `Esc` in a box's normal mode leaves the box; `Esc` on the page cancels, asking y/n first when the draft differs
  from what it opened with. `T` on the page opens the tag picker for the draft; a pick rewrites the Tags box.
- `delete` (`d`): confirm prompt "Delete follow-up <title>?" then `{ type: 'delete', title }`.
- `toggleAgentReady` (`t`): `setTags` with `agent-ready` added or removed, other tags kept in order.
- `pickTag` (`T`): the list picker over the `tags` setting plus any tag on the item; choosing one toggles it.
- `commit` (`C`): only on a home with `gitRoot`; else toast "<root> is not in git". On success toast the message.
- Results: `applied` reloads that home and selects `line`'s item; `missing` toasts "<title> is gone from the file;
  your draft is kept" and keeps the editor open; `titleTaken` toasts and keeps it open; `refused` toasts its reason.
- `changed` message: reload (that home, or all when `homeRoot` is null), keeping the selection by title. An open
  editor keeps its draft through a reload.

## Log lines (pinned; the self-test waits on them)

Through `services.log` under `backlog`, so the page log shows `[backlog] …`:

- `[backlog] shown` — the mode becomes visible
- `[backlog] loaded <n> homes` — after each load or reload
- `[backlog] opened <repo> <~-shown root>` — a home opened
- `[backlog] selected <title>` — the selected row changed
- `[backlog] editor open <create|edit>` / `[backlog] editor closed`
- `[backlog] wrote <path> <applied|missing|titleTaken|refused>` — each `applyEdit` result
- `[backlog] committed <root>` / `[backlog] commit failed <root>: <reason>`
- `[backlog] filter <text>`, `[backlog] done shown|hidden`, `[backlog] agent-ready only on|off`

GIVEN the user presses `t` on an untagged follow-up WHEN the write lands THEN the row shows the `agent-ready` Tag
without a rescan.
GIVEN the done toggle is off WHEN a file holds a struck-through item THEN its row is not in the list.
GIVEN `Space v a` WHEN the list draws THEN only follow-ups tagged `agent-ready` show, and plans and features hide.

Tests:     `backlog-state.test.ts`: `visibleRows` with done hidden and shown, agent-ready-only, the filter over title,
           one line and tags · selection kept by title across a reload · selection clamped when the selected item
           is deleted · open home and back (focus `homes` ↔ `items`) · task rows expand under their plan and
           collapse. View code, CSS and keys earn the self-test and live checks (tasks 10,
           12), not unit tests.
Done when: `npm test -- src/plugins/backlog` passes; `npm run lint` and `npm run typecheck` pass; the app starts
           (`npm run selftest` reaches its first check without a startup error).
Commit:    one commit for the group

## Proof
