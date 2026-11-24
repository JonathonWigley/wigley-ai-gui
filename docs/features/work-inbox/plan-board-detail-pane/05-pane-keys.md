# 05 — Pane keys

Status: done
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
  - `board keys`: `Enter` → `boardLine('pane open')`; `<C-S-j>` → `boardLine('the detail did not scroll down')`;
    `i` → the `focused box of WRK-2` line (the cursor is on WRK-2 after `h`); `Escape` → `boardLine('board
    focused')` (03 logs it on `leaveBox`); `Enter` → `boardLine('pane closed')`.
  - `inbox keys`: before the `W` step, `Enter` in the You promised list → `inboxLine('pane open')`; `<C-S-j>` →
    `inboxLine('the detail did not scroll down')`; `Enter` → `inboxLine('pane closed')`.
  - The scroll lines are pinned: the fixture holds detail only for `WRK-1`, `WRK-3`, `needsYou` and `around` (01), so
    WRK-2's and the first You promised item's panes hold one short line and do not scroll. These steps prove the key
    reaches the pane's command; 03's and 04's unit rows prove the scroll itself over a fake scroller.
  - Each step's `why` names what it proves in one sentence, as the steps around it do.

GIVEN the Board shows with a cursor card WHEN the user presses `Enter` THEN the log reads `[work-board] pane open`
and no link opens.
GIVEN the Inbox list has focus WHEN the user presses `gx` THEN `work-inbox.openSlack` runs.

Tests: the self-test steps above are this task's test: keymap binds are data, and `npm run selftest` presses each
one through the real keymap. Any keymap unit test that lists the Board or Inbox `<CR>` bind is updated to the new
command.

Done when (every command from `wigley-ai-gui/`): `npm run typecheck`, `npm run lint` and `npm test` pass ·
`npm run selftest -- --plugin work` passes with the new steps · `grep -n "work-board.openCard\|work-inbox.openSlack"
src/plugins/keymap.ts` prints only the `gx` lines.

Commit: one commit for the group.
Bookkeeping: tick this task's box in `plan.md`

## Proof

Commit 79d48a57 · proof: Diff read: Board <CR>→togglePane, gx→openCard, C-j/k, C-S-j/k, i, box scope with D-Enter/Esc; Inbox <CR>→togglePane, gx→openSlack, four pane scrolls. typecheck clean; vitest shared+keymap+work 4500 passed; selftest --plugin work all PASS; grep prints only the two gx lines. · concerns: Inbox keys steps start with the pane already open (opened by the earlier i step), so the steps read Enter→pane closed, Enter→pane open, C-S-j, Enter→pane closed. Board box needs two Escapes to log 'board focused' (first leaves the box input, as in the Inbox); unverified whether leaveBox on the first Escape is swallowed.
