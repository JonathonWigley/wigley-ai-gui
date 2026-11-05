# Unity pool

**Contents**

- **Status** — what is built.
- **The pool** — what the app reads and where the rules live.
- **Session row id** — the variable every session the app starts carries.
- **Reading the state** — the files main watches and how it reads them.
- **Row badge** — what a session row shows for its clone.
- **Panel** — the right-bar panel, which pool it shows, and what each clone and ticket shows.
- **Hold and Release** — the two buttons, run through the CLI.
- **Drawing** — the layout parts and what the app keeps.
- **Decisions** — choices a future change would otherwise reopen.
- **Out of scope**

The user keeps several clones of one Unity repo, one per Unity editor, and agent sessions share them through
`unity-pool`, a personal tool in `~/wigley-agents/tools/unity-pool/`. The app shows which clone each session holds,
which sessions wait for one, and the state of every clone of the shown session's repo, and lets the user hold and
release a clone.

## Status

Built, in `src/contracts/agent.ts`, `src/main/claude-code/claude-launch.ts` and `src/shared/session-env.ts` (the launch
variable), `src/shared/origin-repo-names.ts` (the origin-name lookup) and
`src/plugins/unity-pool/` (the state watch, the CLI runs and the self-test script in `main/`; the row badge, the
right-bar panel and their view model in `page/`; the layout contract and the `default` layout in `layouts/`).

## The pool

`~/wigley-agents/tools/unity-pool/README.md` owns every pool rule and the contract the app reads: the State file
schema, the `hold` and `release` JSON results, and `WIGLEY_SESSION_ROW`. A pool is the clones of one origin, named
by the origin URL's last path part without `.git` — the same name the sessions side bar groups a project by
(`docs/features/session-groups/design.md` § Projects). A clone has a number in its pool, and the app names it by
that number: "Unity 3".

The app only reads the state. It changes the pool only by running `unity-pool`, and never writes a file under
`~/.local/state/unity-pool/`.

## Session row id

Every Claude Code session the app starts carries `WIGLEY_SESSION_ROW`, set to its row's id (`SessionRow.sessionId`,
the app's own id for the row). `AgentStart.rowId` carries it to the harness adapter, and the Claude adapter sets the
variable in `claudeLaunch`; `claudeEnv` drops an inherited value, so a `claude` run that is not a session carries
none. A claim records the row beside the session id, so the pool can hand a claim from a session to the session a
`/clear` starts in the same row: `/clear` gives the row a new host session id and keeps its row id
(`setHostSessionId`, `src/plugins/sessions/contract.ts`).

A row's id lasts one app run: a relaunch reopens each saved row with a new id. A process the session host kept
running across the relaunch keeps the variable of its first start. The app still finds that session's claim by its
host session id, but its first `/clear` after the relaunch starts the new process under the new row id, so the pool
does not take the handoff and the claim follows the pool's expiry rules.

## Reading the state

Main watches `~/.local/state/unity-pool/` and reads `<pool>/state.json` in each folder under it.

- Only version 1 is read. A file with any other `version` shows nothing for that pool, and main logs the version
  once.
- A file that does not parse, or holds a field in a shape version 1 does not allow, keeps the pool's last good
  state, since a read can meet a half-written file; main logs the first field it could not read. An editor word it
  does not know reads as `unknown`. The `sessions` map is not read.
- Main converts every time from Unix seconds to epoch milliseconds, so the page compares them with its clock.
- While the folder is missing, main checks for it once a minute and creates nothing: a machine with no pool keeps
  no empty folder.
- After every CLI run, main reads every pool again, so a change the OS watcher misses still shows.

## Row badge

A session row shows one badge per pool its session is in:

- `Unity 3` while it holds clone 3: a claim, or an open `/clear` handoff to it.
- `Unity: queued 2nd` while it waits in the pool's queue, second from the head.

A claim, handoff or queue ticket belongs to the row whose id is its `row`, else, when no row has that id, to the row
whose host session id is its `session`. A user hold and a stranded mark show no badge: they belong to no session, and the panel shows
them.

## Panel

The right bar shows the pool panel while the shown session (the focused pane's) is in a pooled repo: its folder is
inside a clone path of a pool, or its folder's origin repo name is a pool's name. Otherwise the panel is gone.

The panel lists every clone of that pool by number, each with:

- its branch, a dirty mark, and the editor's state in words (`editor ready`, `editor busy`, `in Play Mode`,
  `editor closed`, `editor state unknown`)
- its holder: a session's row label, which selects that row on a click; `Held by you` for a user hold; or
  `session <id start>` for a session the app has no row for
- an open handoff with its time left, a stranded mark with its reason (`claim expired with changes`,
  `session ended with changes`) and age, and a warm-up while it runs or after it failed, with its error
- its Hold or Release button (below)

Under the clones it lists the queue in order: position, the waiting session, its branch and how long it has waited.

When a ticket has waited past the pool's long-wait mark (`longWait`, 10 minutes, set by `unity-pool`), the panel
marks every clone that blocks the queue — held, handed off, stranded or dirty — and shows each holder's idle time
since its last renewal. The app sends no notification for a long wait.

The panel redraws on each state change, each change of the shown session, and once a minute for the times.

## Hold and Release

- **Hold** shows on a clone with no claim, handoff or stranded mark. It runs `unity-pool hold <pool> <n> --json`.
- **Release** shows on a clone the user holds. It runs `unity-pool release <pool> <n> --json`.

Main runs the CLI as `<python> -X utf8 <script> …`, the Python being the `unity-pool.pythonCommand` setting
(`python3` by default; `py` or `python` on a Windows install with no `python3`) and the script the
`unity-pool.scriptPath` setting. Empty, `scriptPath` is `~/.local/bin/unity-pool`, and on Windows
`~/wigley-agents/tools/unity-pool/unity-pool`, since a Windows install writes launchers, not a symlink a Python can
run; `resolveScriptPath` picks it from the platform main reads. A run drops every session variable from the app's
environment (`SESSION_IDENTITY_ENV`, `src/shared/session-env.ts`: `CLAUDE_CODE_SESSION_ID`, `WIGLEY_SESSION_ROW` and
the rest), so the CLI takes it as the user's even in an app started from a Claude Code terminal. A run times out
after 30 seconds. The button is disabled while its run is in
flight, and the clone then shows the result until the page reloads: `Held Unity 3`, `Released Unity 3`, or the CLI's
error message. The CLI's `ok` decides, not its exit code. A script missing from its path gives `no-cli`, and a run
with no JSON answer gives `cli-failed` carrying the last stderr line. The panel offers no release of an
agent's claim or a stranded mark: those take `release --force`, which runs only on the user's word in a terminal.

The panel takes no keys: the buttons and holders are clicks.

## Drawing

The plugin's layout owner is `unity-pool`, with two parts: `rowBadge` (one badge, drawn into a sessions row part)
and `panel` (the whole panel, drawn into the right-bar slot). Inputs carry the words ready for the screen and every
duration in milliseconds for `kit.duration`. The app keeps the row part, the right-bar contribution, the clicks, the
pending runs and every redraw. The default look is in `DESIGN.md` § Surfaces (Unity pool).

## Decisions

- **One state file per pool, read, never written**: `unity-pool` owns every rule and the lock; a second writer
  would need its own copy of the rules.
- **The CLI for every change**: the buttons go through the same checks an agent's command does, and the result the
  panel shows is the CLI's own.
- **Matched on the row, then the session**: the row id survives `/clear`; the host session id survives an app
  relaunch. Together they find the session in both cases.
- **A long wait shows in the panel, with no notification**: the user looks when a session seems stuck, and the
  panel then names what blocks it.
- **Pool membership by clone path, then by origin name**: a session started inside a clone is in its pool; one
  started in a worktree or a subfolder elsewhere still matches through the repo name the side bar already groups by.
- **No keys yet**: the right bar has no focus model; a key route comes with one.

## Out of scope

- Releasing an agent's claim or a stranded mark from the app (`release --force`).
- Claiming a clone from the app: an agent claims for itself.
- Codex sessions: they read the pool but do not claim.
- Keeping a row's id across an app relaunch.
