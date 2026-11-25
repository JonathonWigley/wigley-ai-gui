# 10 — Demo, self-test, skill and docs

Status: not started
Type: Task
Rung: standard · follows agent-skills' demo step and self-test pattern and the docs' existing tables
Wave: 6 · Depends on: 08, 09
Plan: [plan.md](plan.md)

Files:
- create `src/plugins/terminal/main/demo-steps.ts`
- create `src/plugins/terminal/page/demo-steps.ts`
- create `src/plugins/terminal/main/selftest-script.ts`
- modify `src/plugins/terminal/main/start.ts` (register the demo step and the self-test)
- modify `src/plugins/terminal/page/start.ts` (register the page demo beat)
- create `agent-plugin/skills/terminal/SKILL.md`
- modify `README.md`, `CHANGELOG.md`, `AGENTS.md`, `docs/features/layouts/design.md`

Bookkeeping:
- Remove the follow-up "Terminal in the app" from `docs/features/followups.md` (lines 405-414 at plan time; find it
  by its title).

Consumes:
- `Shells.type(sessionId, text)` and `Shells.kill(sessionId)` from `src/plugins/terminal/main/shells.ts` ← 08
- Page log lines `drawer opened in <label>`, `line sent in <label>`, `back to the session in <label>`,
  `drawer closed in <label>` ← 09; classes `.terminal-header-folder` and `.terminal-drawer-screen` ← 09
- In the tree: agent-skills' pattern — `src/plugins/agent-skills/main/demo-steps.ts`,
  `src/plugins/agent-skills/page/demo-steps.ts`, `src/plugins/agent-skills/main/selftest-script.ts`
  (`SELFTEST_PROJECT_NAME`, an `open()` that closes sessions then `chat.launch` and `sessions.activate`, the
  `[chat] Chat tab shown in <project>` line); `services.demoSteps.register`; `services.selfTest?.run(script)`.

Produces:
- Demo step `terminal.drawer`: section `sessions`, order `200`, so it comes after `builds.session` (order 190,
  `src/plugins/builds/page/demo-steps.ts:58`), the last `sessions` step now; 150–190 are taken. Title `Terminal`, caption
  "Each session has its own terminal; an agent types a command there for you to run with Enter.", files
  `src/plugins/terminal/page/start.ts` and `src/plugins/terminal/layouts/default/layout.js`. Main half: launch a
  session with the message `Sign in to the cloud.`, then `shells.type(sessionId, 'gcloud auth login')`; dispose →
  `shells.kill(sessionId)`. Page beat `typed`: activate that session.
- Self-test script (project `terminal-selftest`), group `drawer`:
  | keys | waits for | extra |
  | `['<C-`>']` | `[terminal] drawer opened in terminal-selftest` | screenshot `drawer`, `checksFit: true` |
  | `[...'echo hi', 'Enter']` | `[terminal] line sent in terminal-selftest` | |
  | `['Escape']` | `[terminal] back to the session in terminal-selftest` | |
  | `[' ', 'b', 't']` | `[terminal] drawer closed in terminal-selftest` | |
  `scrollsItself: ['.terminal-header-folder', '.terminal-drawer-screen']`. The self-test always runs on the fake
  host (06).
- `agent-plugin/skills/terminal/SKILL.md` as skill `auri:terminal`.

Decisions:
- **No new drive action.** Task 12 drives the hand-off through the existing `agent-commands.call` and
  `agent-commands.result` drive actions, which run `run_command` and `read_state` as the named session.
- **The skill** (frontmatter `name: terminal`, a `description` naming its triggers: a command only the user can run,
  such as a sign-in, from a session the app started). Body, ASD-STE100 style:
  1. What `terminal.type` does: types one line at the session's shell prompt without Enter, opens the drawer and
     marks the session as needing the user.
  2. When: a command the agent cannot finish itself — a sign-in, a password, a browser hand-off. Not for commands the
     agent can run in its own shell.
  3. Then: ask the user in a forms round (`auri:forms`) to press Enter in the terminal and to answer when it is done.
  4. After: read_state slot `terminal.output`, key `$WIGLEY_SESSION_ROW`, for the last 200 lines as plain text.
  5. Limits: one line only (a line break is refused); no Enter is sent; full-screen programs and keys such as Esc do
     not read well through the output slot.
- **The session note** is 08's; the skill holds the steps the note points to.

Pinned values:
- README Built-in plugins row (after `docs-session-tab`): `| \`terminal\` | A shell for each session in a drawer under
  its tabs, where an agent types a command for the user to run. |` — padded to the table's column widths.
- README Settings row (after the `visual` row): `| \`terminal\` | \`terminal.layout\` |` — the README coverage test
  needs it.
- README Skills row (after `auri:builds`): `| \`auri:terminal\` | Typing a command into the session's terminal for the
  user to run, and reading its output. |`
- CHANGELOG `## Unreleased` › `### Added`: "Each session has a terminal in a drawer under its tabs: `Space b t` or
  Ctrl+backtick opens it, and an agent types a command there for you to run with Enter."
- AGENTS.md:
  - a `terminal/` entry in the `src/plugins/` tree (after `agent-skills/`): the main part keeps one shell per session
    in the session host, owns `terminal.type` and the `terminal.output` slot; the page part draws the drawer with an
    xterm screen through the `TerminalEmulator` service.
  - the main `session-host/` client entry (around line 246) names terminals beside sessions.
  - the `src/session-host/` entry (around line 271) names the terminal table and the node-pty adapter.
  - the `resolveProgram` program list (around line 240: `python`, `claude`, `unity`) gains `shell`.
  - the ambient services: the `src/contracts/` entry (around line 103) names `terminals.ts` (the `TerminalHost`
    behind main `services.terminals`), `pty.ts` and `terminal-emulator.ts` (the `TerminalEmulator` behind page
    `services.terminals`); the "An ambient service" list (around line 1085) gains the session's shells
    (`terminals`, both processes: main's `TerminalHost`, the page's `TerminalEmulator`).
- `docs/features/layouts/design.md` owner table: a `terminal` row after `agent-skills` — the drawer header.

GIVEN the demo runs THEN a session opens with `gcloud auth login` typed in its terminal and the session marked.
GIVEN the self-test runs THEN each of its four steps logs its line and the drawer screenshot fits.
GIVEN `npm test` runs THEN the README coverage test finds `terminal`, `terminal.layout` and `auri:terminal`.

Tests:
- The README coverage test and the self-test harness's script checks already cover the rows and the script. No new
  unit test: the demo step and self-test are data, run live in task 12.

Done when: `npm run typecheck` passes; the README coverage test passes; the follow-up is gone.
Commit:    one commit: "terminal: demo step, self-test, auri:terminal skill and docs"

## Proof
