# Terminal — design

**Contents**

- **Intent** — what the terminal is for, and what it is not.
- **Shape** — one shell per session, in a drawer at the bottom of the session's frame.
- **Where the shell runs** — the session host, the pty contract, replay, and when a shell ends.
- **Keys** — app chords fire; every other key goes to the shell; how focus moves in and out.
- **The agent's hand-off** — `terminal.type`, the row mark, and reading output back.
- **Rejected** — the options the interview turned down, with the reason.

## Intent

The user runs short commands an agent cannot run for them — a sign-in such as `gcloud auth login`, a command print
mode refuses — without leaving the app. The agent types the command into the session's terminal, and the user presses
Enter. The terminal is for running commands, not for editing in a shell: it keeps the app's own keys working inside it.

## Shape

- Each session gets its own shell, started on first use: the first time its drawer opens, or the first time an agent
  types into it. A session that never uses it has no shell.
- The shell starts in the session's folder (`sessions.rows[id].projectDir`), or the home folder when the row has none.
- The default shell is the user's login shell (`$SHELL -l`, else `/bin/zsh -l`) on macOS and Linux and PowerShell
  (`pwsh -NoLogo`, else `powershell.exe -NoLogo`) on Windows: the platform record's `shell` program candidates, so no
  feature code checks the OS.
- A drawer starts closed after an app restart; terminal main reattaches the shell at its own start, and the drawer
  shows its screen again when it next opens.
- The terminal draws in a **drawer**: a strip at the bottom of the session's own frame, under its tabs, which moves
  with the session between panes as a session popup does. Sessions owns the drawer slot (`addDrawer`); the terminal
  plugin fills it. Two panes side by side each show their own session's drawer.
- `Space b t` and `Ctrl+backtick` open and close the focused session's drawer. The drawer's height is dragged and kept
  in the UI state, one height for every drawer.
- The layout draws the drawer's frame (header with the folder, the running or exited state, and restart); the
  emulator draws the grid. The emulator's colours and font come from theme tokens.
- A shell that exits shows its exit line; Enter in the drawer starts a new shell.

## Where the shell runs

- In the host, the pty sits behind a contract (`src/contracts/pty.ts`) with a node-pty adapter. In the app, main plugins
  reach shells through the `TerminalHost` service: the host's terminal table, or a fake shell host in the self-test and
  in a drive run (`WIGLEY_DRIVE_TERMINALS=live` runs real shells there). The emulator sits behind its own contract with
  an xterm.js adapter, handed to plugins as a page service; the page part's tests use a fake emulator, while the
  self-test draws the real one.
- The session host runs each shell in a terminal table of its own, outside the idle rules that end agent processes
  (`docs/features/session-host/design.md` § Terminals). So a shell survives an app restart and reattaches. The host
  keeps the last 256 K UTF-16 code units of each shell's raw output (`TERMINAL_REPLAY_LIMIT`); terminal main seeds its
  buffer from that replay when it adopts the shell, and the drawer writes main's buffer into a fresh emulator when it
  opens, so the screen comes back.
- The pty messages raise the host protocol to 5. An update that changes the host protocol ends every shell
  in the older host when it drains, since the newer app cannot reach them.
- The shell inherits the host's environment, less `ELECTRON_RUN_AS_NODE`, with `TERM=xterm-256color` and
  `COLORTERM=truecolor` set.
- A shell ends when its session's row closes. On app start the terminal plugin lists the host's shells, adopts the ones
  whose row still exists, and ends the rest. A shell whose attach failed, or every shell when the list itself failed, is
  attached by its session's first open, restart or type, which spawns a new shell only when the host holds none or
  that attach fails too. Its row closing first, or the plugin switching off, attaches it to end it; a shell with no row
  whose end failed at adoption is ended by the next app start's adoption or by a switch-off.

## Keys

- App chords (Alt+hjkl, Option+o/i, Cmd+W and the rest bound in scope `any`) fire inside the terminal as everywhere,
  since the page matches chords in the capture phase, before the screen sees the key. The shell gets every other key,
  Enter, Tab and Space included: the screen stops their keydown from bubbling to the page's plain-key matcher, as a
  text box does. So a leader sequence cannot start inside the terminal; the chord
  `Ctrl+backtick` closes the drawer from inside it.
- Esc backs out of the terminal to the session's selected tab (`terminal.back`, bound `<Esc>` in scope
  `terminal.terminal`), as Esc backs out of a box elsewhere. The screen passes Esc to the page and xterm ignores it, so
  the shell never receives Esc; the terminal is not for full-screen programs.
- Alt+j moves focus down from the pane's tab into a visible drawer, and Alt+k moves it back out: the drawer joins the
  session pane's focus moves.

## The agent's hand-off

- The agent runs the app command `terminal.type` through `run_command`, with the command line as its string
  argument. It acts on the calling session's own terminal. It is not risky: it refuses text holding a line break or any
  other control character, so nothing runs until the user presses Enter.
- `terminal.type` starts the shell when none runs, writes the text at the prompt, opens the drawer without moving focus,
  and marks the row "needs you" until the user presses Enter in that terminal or closes the drawer. When the shell exits
  before the text reaches it, the drawer still opens and the command fails with "the shell exited before the text was
  typed", so the agent knows the hand-off did not land.
- The agent reads the last 200 lines of each shell's output, as plain text with escape sequences stripped, from the
  `terminal.output` slot through `read_state`. App commands return no value to an agent, so published state is the
  route.
- Agents learn the ability from a session note chat hands every session it starts, which points at the `auri:terminal`
  skill.

## Rejected

- **A session tab** — the user wants the terminal to pop up over the work, as forms do, not replace the chat on screen.
- **One panel for the whole window** — it would swap shells under the user as focus moves between panes.
- **Neovim's two modes** — the terminal runs commands; nobody edits in it, so the app's chords staying live is worth
  more than the shell's meta keys.
- **A Python pty bridge** — Python's `pty` module does not run on Windows, which the app supports now.
- **Shells held in main** — the user wants a shell to survive an app restart.
- **Moving focus or switching tabs on `terminal.type`** — it would take keys from whatever the user is typing in.
- **Waking the agent when the command exits** — it needs shell integration escape codes in every shell, for a goal a
  forms round's answer already meets.
