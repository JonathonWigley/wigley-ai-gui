# 09 — Terminal plugin page

Status: done
Type: Task
Rung: deep · orders replayed and live output by shell id and sequence number across an async channel, through drawer open, exit, restart and a restart of the main part alone
Wave: 5 · Depends on: 06, 07, 08
Plan: [plan.md](plan.md)

Files:
- create `src/plugins/terminal/page/start.ts` · test `src/plugins/terminal/page/start.test.ts`
- create `src/plugins/terminal/page/palette.ts` · test `src/plugins/terminal/page/palette.test.ts`
- create `src/plugins/terminal/page/layout/read-terminal-layout.ts`
- create `src/plugins/terminal/page/terminal.css`
- create `src/plugins/terminal/layouts/default/layout.js`
- create `src/plugins/terminal/layouts/default/layout.css`
- modify `src/plugins/page.ts`
- modify `src/plugins/keymap.ts`
- modify `docs/keymap.md`

Consumes:
- `PageServices.terminals: TerminalEmulator`, `TerminalScreen`, `TerminalPalette` ← 05/06
  (`src/contracts/terminal-emulator.ts`); `createFakeTerminalEmulator()` ← 06 (tests only)
- `SessionsPageExports.addDrawer(sessionId, view): SessionDrawerHandle` ← 07
- `terminalManifest`, `TerminalChannel`, `TerminalOpened` (with `shell`), `exitReason`, and `layouts/layout.d.ts`
  (`Layout`, `CompleteLayout`, `DrawerHeaderInput`, `TerminalPart`) ← 08
- In the tree: `sessionsPageKey`, `shownSessionId()`, `followRows`, `setActivity(sessionId, source, activity)` and
  `NEEDS_YOU_ACTIVITY` (`src/plugins/sessions/contract.ts`); `coreThemeSlot` (`src/contracts/core-state.ts:30`);
  `api.layouts.show` and `readLayoutParts` as `src/plugins/agent-skills/page/start.ts` and
  `src/plugins/agent-skills/page/layout/read-agent-skills-layout.ts` use them; `api.keys.setScope`;
  `services.paths.tilde(path, homeDir)` (`src/contracts/paths.ts:33`) with `services.homeDir`, as
  `src/plugins/context-sources/page/start.ts:50` calls it.

Produces:
- `src/plugins/terminal/page/start.ts`: `export const terminalPagePart: PagePart<typeof terminalManifest>`, holding
  the page commands `toggle`, `back` and `restart`. Task 10 registers the page demo step and self-test here.
- `src/plugins/terminal/page/palette.ts`:
  ```ts
  export interface TerminalLook { palette: TerminalPalette; fontFamily: string; fontSize: number }
  export function readTerminalLook(style: Pick<CSSStyleDeclaration, 'getPropertyValue'>): TerminalLook;
  ```
- `src/plugins/terminal/layouts/default/layout.js` and `layout.css`: the default `drawerHeader`.
- `src/plugins/page.ts`: `terminalPagePart` in `pageParts`, right after `visualPagePart`.
- `src/plugins/keymap.ts` binds, in the "Tabs and sessions" block right after `<Leader>bh`:
  ```ts
  { keys: '<Leader>bt', scope: 'any', command: 'terminal.toggle' },
  { keys: '<C-`>', scope: 'any', command: 'terminal.toggle' },
  { keys: '<Esc>', scope: 'terminal.terminal', command: 'terminal.back' },
  ```
- Page log lines (shown as `[terminal] …`; task 10's self-test waits on them): `drawer opened in <label>` ·
  `drawer closed in <label>` · `typed in <label>` · `line sent in <label>` · `back to the session in <label>` ·
  `shell exited in <label>: <reason>` · `restarted in <label>` · `open failed in <label>: <error text>` ·
  `no session shown`. `<label>` is the row's label, else its session id.

Decisions:
- **One drawer per session, made lazily.** A drawer is made the first time `toggle` or a `typed` message needs it;
  sessions the user never opens a terminal in get none. A drawer holds: the `SessionDrawerHandle`, a root
  `div.terminal-drawer` with a header host and a `div.terminal-drawer-screen` holding the screen's `element`, the
  `TerminalScreen` (made with the look from `readTerminalLook`), `shell` (the shell id of the last reply, null before
  it), `opened` (false until the first reply), `pending` (true while an `open` or `restart` waits), `queue` (the
  `data` and `exited` messages that arrive while pending), `held` (input that arrives while pending), `sentSize` (the
  size the waiting call sent), `lastSeq`, `exit` and the header's state.
- **`addDrawer` view.** `{ id: 'terminal', element: root, shown, focus }`:
  - `shown()` → `screen.fit()`; then, when not `opened` and not `pending`, `request('open')`.
  - `focus()` → `api.keys.setScope('terminal')`, then `screen.focus()`. A `focusin` on the root also calls
    `api.keys.setScope('terminal')`, so a click into the screen sets the scope too. Never `pushScope`: 07 accepts that
    a layout change or pane move retakes the scope.
- **`request(method)`** (`method` is `open` or `restart`): `pending = true`, `sentSize = screen.size()`, then
  `invoke(method, sessionId, sentSize.cols, sentSize.rows)`. A reply runs `applyReply`. A rejection runs `failed`.
- **`applyReply(reply)`**, in order:
  1. `screen.reset()` when `shell` is not null (the screen shows an earlier shell or an earlier copy of this one).
  2. `screen.write(reply.buffer)` when it is not empty; `shell = reply.shell`, `lastSeq = reply.seq`,
     `exit = reply.exit`, `opened = true`, `pending = false`.
  3. `reply.exit` not null → write the exit line. So a drawer opened late on an exited shell shows its exit.
  4. Each queued message, in arrival order, whose `shell` is `reply.shell`: a `data` with `seq > lastSeq` is written
     and raises `lastSeq`; an `exited` runs the exit step (below) when `exit` is still null. Every other queued
     message is dropped: it belongs to the shell the reply replaced. The queue is emptied.
  5. `exit` null and `screen.size()` not equal to `sentSize` → `invoke('resize', sessionId, cols, rows)` with
     `screen.size()`. The adapter (05) refits on its own while the call waits, and step 5 sends the last size.
  6. The `held` input runs through the Input rules (below), one entry at a time, in order; `held` is emptied first.
  7. The header redraws. A reply to `restart` then logs `restarted in <label>`.
- **`failed(error)`**: `pending = false`, `queue` and `held` emptied,
  `screen.write('\r\n[terminal: <error text>]\r\n')`, log `open failed in <label>: <error text>`. `opened` keeps its
  value, so a drawer never opened tries again at its next `shown()`.
- **Messages.** A `data` or `exited` message:
  - no drawer → dropped;
  - `pending` → queued;
  - not `opened` → dropped (the next reply's buffer holds it);
  - its `shell` not the drawer's `shell` → `request('open')`, and the message is dropped. The main part made a new
    shell (a `type` on an exited shell), or the main part restarted alone and adopted the shell again. The reply's
    buffer holds the message.
  - else a `data` with `seq > lastSeq` is written and raises `lastSeq`; an `exited` runs the exit step.
- **Exit step.** `exit` set; write the exit line; the header redraws as `exited`; log
  `shell exited in <label>: <reason>`. `<reason>` is `exitReason(exit)`.
- **Keys.** The page adds no key listener and no `ResizeObserver`: the xterm adapter (05) passes Escape on, stops
  every other key at the screen, and refits on its own. `<Esc>` in scope `terminal.terminal` runs `terminal.back`.
  The screen's `onResize(size)` → `invoke('resize', sessionId, size.cols, size.rows)` when `opened`, not `pending`,
  and `exit` is null. While a call waits, `applyReply` step 5 sends the size.
- **Input.** `screen.onInput(data)`:
  - `pending` → pushed to `held`. Main writes nothing for a shell that does not exist yet, so input is kept, not
    sent.
  - not `opened` → dropped.
  - `exit` not null and `data` holds `\r` → restart (below).
  - `exit` not null otherwise → dropped.
  - else `invoke('write', sessionId, data)`; when `data` holds `\r`: clear the mark
    (`setActivity(sessionId, 'terminal', null)`) and log `line sent in <label>`.
- **`typed` message.** Ensure the drawer, `handle.open({ focus: false })`, then
  `setActivity(sessionId, 'terminal', NEEDS_YOU_ACTIVITY)`, then log `typed in <label>`. Then, when the drawer is
  `opened`, not `pending`, and the message's `shell` is not the drawer's `shell`, `request('open')`: the main part
  spawned a new shell for the text, and its reply replaces the old screen.
- **Restart** (Enter after an exit, or the `restart` command with the session id): only for a drawer that is
  `opened`, not `pending`, and whose `exit` is not null. Then `request('restart')`; `applyReply` resets the screen and
  logs. Any other drawer, or no drawer for that id, → nothing. A running shell is never restarted from the page: the
  user ends it with `exit` first.
- **`toggle`.** Target `sessions.shownSessionId()`. Null → log `no session shown`. A drawer that `isOpen()` →
  `handle.close()`, clear the mark, log `drawer closed in <label>`. Else ensure the drawer,
  `handle.open({ focus: true })`, log `drawer opened in <label>`. `open` focuses only a visible drawer (07).
- **`back`.** Only for the session whose drawer holds focus (the drawer whose root contains
  `document.activeElement`): `handle.returnFocus()` and log `back to the session in <label>`. No drawer holds focus →
  nothing, and no log. `returnFocus` (07) hands the keys to the focused pane's selected tab only while the drawer holds
  focus, so the log is written only when focus moved.
- **Rows.** `sessions.followRows(rows)`: a session id that leaves the rows → `handle.dispose()`, `screen.dispose()`,
  the drawer forgotten. The main part kills its shell on `sessions.closed` (08).
- **Look.** `readTerminalLook(getComputedStyle(document.documentElement))` at start and on every change of
  `coreThemeSlot`; each change calls `screen.setPalette(palette, fontFamily, fontSize)` on every screen. Tokens read
  (trimmed): background `--wg-transcript-background`, foreground `--wg-fg`, cursor `--wg-accent`, selection
  `--wg-accent-tint`, font family `--wg-font-mono`, font size `parseFloat(--wg-text-13)`. A size that does not parse
  falls back to 13.
- **Header.** `api.layouts.show<CompleteLayout>({ defaultLayout, defaultStylesheet, read: readTerminalLayout,
  userLayout: () => api.settings().layout, setLayouts })`, as agent-skills' page does. Each drawer draws
  `show.draw('drawerHeader', headerHost, input)` with `input = { sessionId, folder:
  services.paths.tilde(reply.folder, services.homeDir), state, exitReason }`, and redraws on every state change.
  `state` is `starting` until the first reply, `running` while `exit` is null, `exited` after.
- **Default header (`layout.js`).** A row: a `span.terminal-header-folder` with the folder as text and `title`; a
  `kit.tag` — `starting` tone `neutral`, `running` tone `running`, `exited: <reason>` tone `error`; and, only when
  `input.state` is `exited`, `kit.button(parent, 'Restart', 'terminal.restart', { arg: input.sessionId })`. Styles
  only in `layout.css`.
- **Styles.** `terminal.css` (imported by `start.ts`) makes `.terminal-drawer` a column that fills the drawer frame,
  `.terminal-drawer-screen` take the rest with `min-height: 0`, and `.terminal-screen` fill it. No inline styles
  (the style check refuses them).
- **Stop.** Every drawer handle and screen disposed; every listener and subscription removed.

Pinned values:
- Exit line: `\r\n[shell exited: <reason>] Press Enter to start a new shell.\r\n`.
- Failure line: `\r\n[terminal: <error text>]\r\n`.
- Activity source `'terminal'`; activity `NEEDS_YOU_ACTIVITY`; view id `'terminal'`; scope `'terminal'`
  (`terminal.terminal` in keys).
- Keys: `<Leader>bt` and `<C-`>` → `terminal.toggle` (scope `any`); `<Esc>` → `terminal.back` (scope `terminal.terminal`).
- `docs/keymap.md`: the `b` row of the Leader groups table gains `bt` open or close the session's terminal; the session
  key list (around line 161) gains `bt`; the Layers section gains a bullet: "Ctrl+backtick also opens or closes the
  session's terminal. In the terminal, keys go to the shell; Esc leaves the terminal for the session, and the
  `Space` leader does not work there."

GIVEN a `typed` message for a session WHEN it arrives THEN the drawer opens without focus and the session is marked
as needing the user.
GIVEN a marked session WHEN the user sends a line with Enter, or closes the drawer, THEN the mark clears.
GIVEN an `open` reply with buffer `ab` and seq 2 WHEN data with seq 1, 2 and 3 arrives THEN only seq 3 is written.
GIVEN data that arrives while `open` waits THEN it is written after the buffer when its shell is the reply's and its
seq is higher.
GIVEN a `restart` that waits WHEN chunks of the old shell arrive THEN they are dropped.
GIVEN an opened drawer WHEN data or `typed` of another shell id arrives THEN the drawer opens again and the reply
replaces the screen.
GIVEN input or a screen resize while `open` waits THEN the input is written and the last size is sent after the
reply.
GIVEN a reply whose `exit` is set THEN the exit line is written after the buffer.
GIVEN an exited shell WHEN the user presses Enter THEN the screen resets and a new shell starts.
GIVEN a running shell WHEN the `restart` command runs THEN nothing is invoked.
GIVEN `open` rejects THEN the failure line is written and logged.
GIVEN no drawer holds focus WHEN `back` runs THEN nothing happens and nothing is logged.
GIVEN no shown session WHEN toggle runs THEN it logs `no session shown`.
GIVEN a theme change THEN every screen gets the new palette.

Tests:
- `palette.test.ts` — `readTerminalLook_ReadsTheTokens`: a style answering `--wg-transcript-background` `' #111 '`,
  `--wg-fg` `#eee`, `--wg-accent` `#f80`, `--wg-accent-tint` `#f803`, `--wg-font-mono` `Menlo`, `--wg-text-13` `13px`
  → `{ palette: { background: '#111', foreground: '#eee', cursor: '#f80', selection: '#f803' }, fontFamily: 'Menlo',
  fontSize: 13 }`; `it.each` `'readTerminalLook_FontSize_$case'`: `'14px'` → 14, `''` → 13.
- `page/start.test.ts`, on `startPagePart` with `installFakeDom`, `services: { terminals:
  createFakeTerminalEmulator() }`, a fake `sessionsPageKey` dependency (records drawer views, `open` and `close`
  calls, `returnFocus`, `setActivity` calls; a settable shown session `s1`, label `alpha`; followRows driven by the
  test), the `layoutShow` option (the harness's default `layouts.show` draw throws `layouts.show draw not faked`), and
  an `invoke` double that answers `open` and `restart` with a test-held reply, resolved or rejected by the test. The
  reply `R` is `{ shell: 'A', buffer: 'ab', seq: 2, folder: '/work/alpha', exit: null }`:
  - `stop_LeavesNoLiveRegistration`, `stopThenStart_StartsAgain`.
  - `typed_OpensWithoutFocusAndMarks` — `send('typed', { sessionId: 's1', shell: 'A', text: 'x' })`: one
    `open({ focus: false })`, `setActivity('s1', 'terminal', NEEDS_YOU_ACTIVITY)`, log `typed in alpha`.
  - `it.each` `'input_Mark_$case'` — after `typed` and the reply `R`, `type('x')` → no `setActivity(…, null)`;
    `type('\r')` → `setActivity('s1', 'terminal', null)` and log `line sent in alpha`; both invoke `write` with the
    data.
  - `toggle_OpenDrawer_ClosesAndClearsTheMark` — toggle twice: `open({ focus: true })`, then `close()`,
    `setActivity('s1', 'terminal', null)`, logs `drawer opened in alpha` and `drawer closed in alpha`.
  - `toggle_NoShownSession_Logs` — `no session shown`, no drawer added.
  - `shown_FirstTime_OpensAtTheScreenSize` — screen size 100×30: `invoke('open', 's1', 100, 30)` once over two
    `shown()` calls.
  - `it.each` `'data_Order_$case'` (the first reply `R`), `written` the screen's writes and `resets` its reset count:
    | case | messages, and when they arrive | written | resets |
    | after the reply | `data` A seq 1 `'a'`, 2 `'b'`, 3 `'c'` after | `['ab', 'c']` | 0 |
    | while open waits | `data` A seq 3 `'c'` before | `['ab', 'c']` | 0 |
    | stale while waiting | `data` A seq 2 `'b'` before | `['ab']` | 0 |
    | other shell while waiting | `data` B seq 1 `'z'` before | `['ab']` | 0 |
    | no drawer | `data` A seq 1 `'a'` for `s2` | no screen | 0 |
  - `it.each` `'newShell_Reopens_$case'` — after the reply `R`: a `data` B seq 1 `'z'`, and a `typed` with shell B,
    each → a second `invoke('open', 's1', …)`; its reply `{ shell: 'B', buffer: '$ z', seq: 1, … }` → `resets` 1 and
    the last write `'$ z'`; the message that caused it is not written.
  - `restart_DropsOldQueuedChunks` — reply `R` with `exit` `{ code: 0, signal: null, error: null }`; `type('\r')`;
    while `restart` waits, `data` A seq 3 `'old'`; reply `{ shell: 'B', buffer: '', seq: 0, … }` → `resets` 1, no
    write of `'old'`, log `restarted in alpha`.
  - `reply_WithExit_WritesTheExitLine` — reply `R` with `exit` `{ code: 0, … }`: written `['ab',
    '\r\n[shell exited: code 0] Press Enter to start a new shell.\r\n']`.
  - `exited_WhileWaiting_WrittenAfterTheBuffer` — `exited` A `{ code: 0, … }` before the reply `R`: written ends with
    the exit line after `'ab'`, and log `shell exited in alpha: code 0` once.
  - `pending_HoldsInputAndSendsTheLastSize` — screen size 100×30 at `shown()`, then `type('l')`, `type('s')` and
    `resizeTo({ cols: 90, rows: 20 })` before the reply: no `write` or `resize` invoke yet; after the reply `R`,
    `invoke('resize', 's1', 90, 20)`, then `invoke('write', 's1', 'l')` and `invoke('write', 's1', 's')`.
  - `resize_Opened_InvokesResize` — after the reply `R`, `resizeTo({ cols: 90, rows: 20 })` →
    `invoke('resize', 's1', 90, 20)`.
  - `exited_WritesTheLineAndEnterRestarts` — after the reply `R`, `send('exited', { sessionId: 's1', shell: 'A',
    exit: { code: 0, signal: null, error: null } })`: written ends with
    `\r\n[shell exited: code 0] Press Enter to start a new shell.\r\n`; then `type('\r')` → `invoke('restart', 's1',
    …)`, no `write` invoke; the restart reply → `resets` 1.
  - `it.each` `'restartCommand_$case'` — the `restart` command with `'s1'`: running shell → no `restart` invoke;
    exited shell → one `restart` invoke; no drawer → nothing.
  - `open_Rejects_WritesTheFailure` — the `open` reply rejects `Error('terminal found no shell program to start')`:
    the last write `'\r\n[terminal: terminal found no shell program to start]\r\n'`, log `open failed in alpha:
    terminal found no shell program to start`; a later `shown()` invokes `open` again.
  - `it.each` `'back_$case'` — focus inside the drawer's root (the screen element's `focus()`) → `returnFocus` once,
    log `back to the session in alpha`; focus outside every drawer → `returnFocus` not called, nothing logged.
  - `focus_SetsTheTerminalScope` — after the view's `focus()`, `scope()` is `terminal.terminal` and the screen's
    `focuses` is 1.
  - `rowRemoved_DisposesTheDrawer` — the handle's `dispose` and the screen's `disposed` both run.
  - `themeChange_SetsThePaletteOnEveryScreen` — two drawers; a new `coreThemeSlot` value: each screen's `palettes`
    gains one entry.
- The keymap binds are covered by the existing `defaultKeymap_MergedWithBuiltIns_PassesKeymapChecks`.
- The default header's Restart button shows only when exited: a layout look, checked live in task 12.

Done when: `npm run typecheck` passes; the tests above exist; the test gate runs them.
Commit:    one commit: "terminal: page part — the drawer per session with its screen, header layout and keys"

## Proof

Commit 8da257e4 · proof: diff read: terminalPagePart with toggle/back/restart, readTerminalLook, default drawerHeader layout, page.ts entry after visualPagePart, the three binds after <Leader>bh, keymap.md rows; wave 5 typecheck, oxlint, layers, boundary, styles clean; oxfmt commit 5acfe63b · concerns: <C-`> is a chord in scope any with no key-hint anchor, so the self-test's placement check fails until one is placed (main-agent ruling: task 10 adds it); layouts design.md owner list lacks terminal's drawerHeader (task 10/11); typed for a session with no row reaches addDrawer unchecked; the view's shown closure reads drawer before it is set, safe only because a drawer starts closed
