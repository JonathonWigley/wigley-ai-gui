# 12 — Final verification

Status: not started
Type: Task
Wave: 7 · Depends on: none (`wigley:make` runs it after its test gate)
Plan: [plan.md](plan.md)

Files:     none
Consumes:  the landed run

`wigley:make` walks this task once, in its live session, after its test gate. Every live check of the plan is here.
Risk tier: High — a new native module, a host protocol change, and shells that outlive the app. Drive every check
through `npm run drive` (`.agents/skills/drive/SKILL.md`); take a screenshot where a check names one and read it
against `DESIGN.md`.

## Setup

1. `npm run drive -- start` (fake terminal host). Seed one chat session with `npm run drive -- do chat.start '{}'`.
   Call its `sessionId` `S` and its row's label `L` (the `[terminal] … in <label>` lines show it).
2. For the real-shell checks: `npm run drive -- start --terminals live` (task 06's flag), seeded the same way, with
   the session's folder set to the run's home or a temp folder.
3. For the packaged check: `npm run package`, then `npm run drive -- start --packaged --terminals live`.

Conventions for every check:
- `SCREEN` is the selector `.terminal-drawer-screen .xterm-rows`. "The screen shows X" means
  `npm run drive -- query '<SCREEN>'` returns text that holds X.
- "Focus is in the drawer" means
  `npm run drive -- eval "document.activeElement?.closest('.terminal-drawer') !== null"` returns `true`; "focus is
  outside the drawer" means it returns `false`.
- "Logs X" means the drive command's returned log lines hold X.
- The Space leader works only with focus outside the drawer: in the drawer, Space goes to the shell (09). Every check
  presses `Escape` before a `Space` sequence when focus is in the drawer.

## Checks

Expected paths:

1. **Toggle and draw** (expected: the feature's main path). With the chat focused, run
   `npm run drive -- key '<C-`>'`: it logs `[terminal] drawer opened in L`, focus is in the drawer, and the screen
   shows `$ `. Screenshot `terminal-drawer-open`. Run `npm run drive -- key Escape`, then
   `npm run drive -- key Space b t`: it logs `[terminal] drawer closed in L`. Run `npm run drive -- key Space b t`
   again: it logs `drawer opened in L`, and the screen shows the same text as before.
2. **Keys reach the shell** (expected). Run `npm run drive -- click '.terminal-drawer-screen'`, then
   `npm run drive -- type 'echo hi'`, then `npm run drive -- key Enter`: it logs `[terminal] line sent in L`, and
   the screen shows `ran: echo hi`. Run `npm run drive -- type 'a b'`, then `npm run drive -- key Tab`: the screen
   shows `a b`, focus is in the drawer, and screenshot `terminal-keys` shows no leader menu.
3. **Esc and focus moves** (low-confidence: the focus wrapper has no live coverage). With focus in the drawer, run
   `npm run drive -- key Escape`: it logs `[terminal] back to the session in L`, focus is outside the drawer, and
   `npm run drive -- query '.session-drawer-host'` shows the host not hidden. Run `npm run drive -- key '<A-j>'`:
   focus is in the drawer. Run `npm run drive -- key '<A-k>'`: focus is outside the drawer. Run
   `npm run drive -- key '<A-j>'`, then `npm run drive -- key '<C-`>'`: it logs `drawer closed in L` (a scope `any`
   chord fires inside the drawer). Run `npm run drive -- key '<C-`>'` to open it again.
4. **Agent hand-off** (expected). Run
   `npm run drive -- do agent-commands.call '{"sessionId":"S","tool":"run_command","args":{"command":"terminal.type","arg":"gcloud auth login"}}'`,
   then `npm run drive -- do agent-commands.result '{"callId":"<the callId it returned>"}'`: the result reads
   `Ran terminal.type.` The page logs `[terminal] typed in L`, focus did not move (run the focus check before and
   after), the screen shows `gcloud auth login` with no `ran: gcloud auth login`, and the row shows the "needs you"
   mark. Screenshot `terminal-typed`. Run `npm run drive -- click '.terminal-drawer-screen'` (focus is in the drawer),
   then `npm run drive -- key Enter`: it logs `line sent in L`, and screenshot `terminal-typed-sent` shows the row
   with no mark. The same call with `"arg":"a\nb"` gives a result holding
   `terminal.type takes one line: the text holds a line break`.
5. **Output slot** (expected). Run
   `npm run drive -- do agent-commands.call '{"sessionId":"S","tool":"read_state","args":{"slot":"terminal.output","key":"S"}}'`
   and read its result the same way. The result is a JSON string (read_state returns JSON) that holds
   `ran: echo hi` and `ran: gcloud auth login`, and holds no `\u001b`.
5a. **Theme** (low-confidence: the palette reads tokens at runtime). Run
   `npm run drive -- query '.terminal-drawer-screen .xterm-viewport' background-color`, then switch the theme with
   `npm run drive -- setting theme '"<another built-in theme>"'`, then run the same query: the colour changed and
   equals `npm run drive -- query -- :root --wg-transcript-background` as resolved. Screenshot `terminal-theme`.
5b. **Demo step** (expected). Run
   `npm run drive -- do agent-commands.call '{"sessionId":"S","tool":"run_command","args":{"command":"demo.goTo","arg":"terminal.drawer"}}'`
   and read its result: `Ran demo.goTo.` A new session opens with its drawer open, its screen shows
   `gcloud auth login`, and its row shows the "needs you" mark. Screenshot `terminal-demo`.
6. **Drawer layout** (low-confidence: a new grid row and a layout part). With the drawer open, run
   `npm run drive -- key Escape` (when focus is in the drawer), then `npm run drive -- key Space b p`: the popup
   covers the tab body, not the drawer (screenshot `terminal-popup`). Close the popup with the same keys. Run
   `npm run drive -- drag '.session-drawer-handle' 0 -120`: `npm run drive -- query '.session-drawer-host'` shows a
   height 120 px larger. Run `npm run drive -- restart`, then `npm run drive -- key '<C-`>'`: the new drawer has the
   dragged height. Seed a second session (`npm run drive -- do chat.start '{}'`) and open its drawer the same way.
   Run `npm run drive -- key Escape`, then `npm run drive -- key '<A-;>'` (`sessions.splitRight`), and show the
   first session in the new pane: each pane shows its own session's drawer, and
   `npm run drive -- query '.session-drawer-host:not([hidden])'` returns two matches. Run `npm run drive -- fit`
   with the drawers open: nothing is cut off at the minimum width. Drag the drawer's handle to its highest
   (`npm run drive -- drag '.session-drawer-handle' 0 -2000`), then run `npm run drive -- resize 1200 480`: the
   drawer row shrinks, and
   `npm run drive -- eval "[...document.querySelectorAll('.session-bodies')].map((e) => e.getBoundingClientRect().height)"`
   gives only values of 160 or more. Screenshot `terminal-two-panes`.
7. **Exit and restart** (low-confidence: exit path). With focus in the drawer, run `npm run drive -- type exit`, then
   `npm run drive -- key Enter`: it logs `[terminal] shell exited in L: code 0`, the screen shows
   `[shell exited: code 0] Press Enter to start a new shell.`, and screenshot `terminal-exited` shows the header's
   exited tag and its Restart button. Run `npm run drive -- key Enter`: it logs `restarted in L`, the screen shows `$ `
   and no exit line, and `npm run drive -- query '.terminal-drawer button.ui-button'` returns no match.
7a. **Restart by the header button** (low-confidence: a layout button runs a page command). Exit the shell again as
   in check 7, then run `npm run drive -- click '.terminal-drawer button.ui-button'`: it logs `restarted in L`, and
   the screen shows `$ ` and no exit line.
7b. **Type into an exited drawer** (low-confidence: the page reopens on a new shell id). Exit the shell again as in
   check 7. Run the `terminal.type` call of check 4 with `"arg":"ls"`: it logs `typed in L`, and the screen shows
   `$ ls` and no exit line.
7c. **The main part restarts alone** (low-confidence: the page keeps its drawers while main adopts the shells again).
   With the drawer open, run `npm run drive -- do core.restartPlugin '{"id":"chat"}'`: it restarts chat and the
   plugins that depend on it. Terminal main depends on chat; terminal page depends on sessions only. Then, with focus in the drawer, run `npm run drive -- type 'echo after'` and
   `npm run drive -- key Enter`: the screen shows `ran: echo after`.

Real shell (`--terminals live`), low-confidence: the pty, environment and host table are unit-tested only through
fakes:

8. **Real shell starts** — open the drawer: the user's login shell prompt appears in the session's folder. Run
   `pwd; echo $TERM $COLORTERM "[$ELECTRON_RUN_AS_NODE]"`: it prints the folder, `xterm-256color truecolor []`.
9. **Resize** — run `tput cols` and note the number. Run `npm run drive -- resize 1400 900`, then `tput cols`: it
   prints a larger number. Then run `printf '%*s|\n' "$(($(tput cols) - 1))" ''`: screenshot `terminal-resize` shows
   one line whose `|` sits in the screen's last column, with no wrap. So the shell's column count is the screen's.
10. **Survives a restart** — run `echo before-restart` and `echo $$`, then `npm run drive -- restart`. Open the drawer:
    the screen shows `before-restart` from the replay, and `echo $$` prints the same pid as before.
11. **Ends with its row** — note the shell's pid (`echo $$`), close the session's row, then check with
    `ps -p <pid>` that the process is gone.
12. **Packaged build** — in the packaged run, check 8 passes: node-pty loads from the package.

Self-test:

13. `npm run selftest` passes, with the terminal plugin's steps among them.

## Dropped

Each GIVEN/WHEN/THEN a task's test pins is left out here: the table, ring buffer, drain, exit rule, protocol and
client routing (tasks 02, 03), the drawer's lifetimes and focus wrapper rules (07), the escape stripper, line cap,
debounce, `terminal.type` errors, the one start per session and adoption (08), and the shell id and seq rules, held
input and mark clearing (09). The checks above cover only what those tests cannot see: the screen, real keys through
the page, the header's layout, a plugin restart in the running app, the real pty, and packaging.

## Not checked by the agent

Windows (ConPTY, PowerShell), and a physical keyboard's Ctrl+backtick on a non-US layout. The wrap-up names these in
its `Not checked:` line.

## Proof
