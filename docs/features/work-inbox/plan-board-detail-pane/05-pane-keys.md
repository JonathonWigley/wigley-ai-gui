# 05 — Pane keys

Status: not started
Type: Task
Rung: standard · binds commands 03 and 04 already ship, and adds self-test steps for them
Wave: 5 · Depends on: 03, 04
Plan: [plan.md](plan.md)

Files:
- modify `wigley-ai-gui/src/plugins/keymap.ts`
- modify `wigley-ai-gui/src/plugins/work/main/selftest-script.ts`

This task does not edit `docs/keymap.md`: task 06 does, against the binds landed here.

Consumes:
- Board page commands in `src/plugins/work-board/manifest.ts` ← 03: `togglePane`, `openCard` (kept id, new label),
  `lineDown`, `lineUp`, `halfPageDown`, `halfPageUp`, `enterBox`, `send`, `leaveBox`; the new scope `box`
  (`work-board.box`). Logs: `pane open`, `pane closed`, `no pane`, `no box for <id>`, `focused box of <id>`.
- Inbox page commands in `src/plugins/work-inbox/manifest.ts` ← 04: `togglePane`, `paneLineDown`, `paneLineUp`,
  `paneHalfPageDown`, `paneHalfPageUp`; `openSlack`, `editDraft`, `send` and `leaveBox` kept. Logs: `pane open`,
  `pane closed`, `no pane`.
- The scroll log text from `scrollText` in `src/shared/content-scroll.ts` — tree.

Produces: the binds below, and self-test steps that press them.

Decisions:

- **Board binds**, scope `work-board.board` (`keymap.ts`, the Board block, about lines 997–1016 at plan time,
  re-verify):
  - `<CR>` → `work-board.togglePane` (replaces `work-board.openCard`)
  - `gx` → `work-board.openCard`
  - `<C-j>` → `work-board.lineDown`, `<C-k>` → `work-board.lineUp`
  - `<C-S-j>` → `work-board.halfPageDown`, `<C-S-k>` → `work-board.halfPageUp`
  - `i` → `work-board.enterBox`
- **Board box binds**, scope `work-board.box`: `<D-Enter>` → `work-board.send`, `<Esc>` → `work-board.leaveBox`. Add
  `'work-board.box'` to the per-main-view scope list beside `'work-board.board'` (about line 261). Write each bind in
  the form the Inbox box binds use (about lines 990–995), Esc included.
- **Inbox binds**, scope `work-inbox.list` (about lines 961–983):
  - `<CR>` → `work-inbox.togglePane` (replaces `work-inbox.openSlack`)
  - `gx` → `work-inbox.openSlack`
  - `<C-j>` → `work-inbox.paneLineDown`, `<C-k>` → `work-inbox.paneLineUp`
  - `<C-S-j>` → `work-inbox.paneHalfPageDown`, `<C-S-k>` → `work-inbox.paneHalfPageUp`
  - `i`, `<D-Enter>` in the list and the box's `<D-Enter>`/`Esc` stay as they are.
- No other scope takes these keys. Before binding, grep `keymap.ts` for `'gx'`, `<C-j>` and `<C-S-j>` in these four
  scopes and in `any`: a clash is reported, not rebound.
- **Self-test steps** (`selftest-script.ts`), added to the existing key groups after their last step:
  - `board keys`: `Enter` → `boardLine('pane open')`; `<C-S-j>` → the scroll line `scrollText` gives for the pane
    (read the exact text from `content-scroll.ts`: with the fixture's short detail the pane may not scroll, and the
    line says so); `i` → the `focused box of WRK-2` line (the cursor is on WRK-2 after `h`); `Escape` → the Board's
    leave-box line; `Enter` → `boardLine('pane closed')`.
  - `inbox keys`: before the `W` step, `Enter` in the You promised list → `inboxLine('pane open')`; `<C-S-j>` → the
    pane's scroll line; `Enter` → `inboxLine('pane closed')`.
  - Each step's `why` names what it proves in one sentence, as the steps around it do.

GIVEN the Board shows with a cursor card WHEN the user presses `Enter` THEN the log reads `[work-board] pane open`
and no link opens.
GIVEN the Inbox list has focus WHEN the user presses `gx` THEN `work-inbox.openSlack` runs.

Tests: the self-test steps above are this task's test: keymap binds are data, and `npm run selftest` presses each
one through the real keymap. Any keymap unit test that lists the Board or Inbox `<CR>` bind is updated to the new
command.

Done when: `npm run typecheck`, `npm run lint` and `npm test` pass · `npm run selftest -- --plugin work` passes with
the new steps · `grep -n "work-board.openCard\|work-inbox.openSlack" wigley-ai-gui/src/plugins/keymap.ts` prints only
the `gx` lines.

Commit: one commit for the group.
Bookkeeping: tick this task's box in `plan.md`

## Proof

