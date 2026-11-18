# Live view auto-open — plan

Feature: Live view · Implements: none · Ticket: none
Target: main · Written: 2026-11-17

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

The app opens a session's Live view on its own when that session starts a Unity playtest, so the user never has to
ask for the screen share. It works for any Unity project that uses the `unity` CLI, with no project-specific
(new-games) knowledge. The app closes a view it opened when the playtest stops. The agent's own pick always wins.

## Architecture

All code is in the `live-view` plugin's main part (`wigley-ai-gui/src/plugins/live-view/`), plus one fake send text in
the shared fake agent harness for the self-test.

- **Reads:** chat's `chat.entries` list slot (the Bash call's full `input.command`, which holds the
  `--project-path`), chat's `chat.agentEvent` event (the live marker: `toolStarted` with `replayed: false`), and
  `sessions.ended`.
- **Writes:** only the `live-view.picks` slot, through `LiveTools`, which owns the pick.
- **New module:** `playtest-command.ts`, a pure parser from a Bash command text to a playtest signal.
- **Manifest:** `dependsOn` and `reads` stay as they are: chat is already in `dependsOn.main`, so its slots and
  events are readable now. Only the header comment changes.

## Preconditions

- The worktree `/Users/jonathonwigley/Documents/.worktrees/ai-live-auto-open` (branch `live-auto-open`) branched
  from `e23142c0e`, which was local `main` and `origin/main` when the plan was written (checked with
  `git rev-parse 694e2682c~1`). `origin/main` has moved since: `wigley:make` brings the branch up to the target's tip
  before the run, and the landing rebases. Re-check each tree claim below against that tip.
- Chat tells a live Bash call from a replayed one only through its private `replay.isReplaying`
  (`src/plugins/chat/main/chat-sessions.ts`, `processEvents` → `entry(entry)` → `noteBashCommand(session, entry,
  replay.isReplaying)`); the `chat.entries` slot carries no such flag. The public live marker is
  `ChatAgentEvent.replayed`, emitted in the same `processEvents` (`agentEvent(event)`:
  `replayed: replay.isReplaying && event.type !== 'sessionEnded'`). A re-attach's replay puts every entry again and
  emits `toolStarted` with `replayed: true` (`src/plugins/claude-code/main/session-fold.ts`, the replay fold). A
  restore writes entries through `replaceEntries` (a list `replace` change) and emits no `toolStarted`. Verified by
  reading those functions at `e23142c0e`.
- The order of a tool's entry put and its `toolStarted` is not fixed across harnesses: the fake harness puts the
  entry first (`startFakeTool` in `src/shared/fake-agent-harness.ts`); the Claude Code harness emits both from one
  folded line (`claude-code-harness.ts`, `events.entry` / `events.agentEvent`). The watch handles both orders.
- The `ChatEntry` tool shape holds `toolUseId`, `name`, `input`, `result` (`src/contracts/agent.ts`, `kind: 'tool'`).
- The fake agent harness carries a Bash call's `input` through to the entry (`emitToolTurn` in
  `src/shared/fake-agent-harness.ts`: `input: { command: 'echo fake' }`).
- The `unity` CLI takes `--project-path <path>` on `unity command` (checked by the coordinator with
  `unity command --help`: `--project-path <path>  Path to Unity project (auto-detected if not …`).
- A test publishes another plugin's slot with `harness.state.publish(key)` (precedent:
  `src/plugins/agent-strip/page/start.test.ts`, `harness.state.publish(agentsRostersSlot)`).

## Docs written ahead

- `wigley-ai-gui/docs/features/live-view/design.md` — "What it is" no longer says the agent alone starts and stops
  Live; new section "The playtest watch"; Rejected rewritten and gains "A setting to turn the playtest watch off".
  Commit `694e2682c`; its folder rule rewritten to the command's `--project-path` only, and Rejected gains
  "Guessing the playtest's project folder", in commit `dfe96e014`; the open and close bullets moved to "once the
  call succeeds" and "the same project" in the commit "plan-auto-open: close the cold readers' gaps". Each new behaviour is marked "planned in
  `plan-auto-open`, not built yet"; task 04 drops the marks.
- `wigley-ai-marketplace/plugins/wigley/skills/unity-playtest/SKILL.md` § Session setup — `unity command editor_play`
  takes `--project-path <dir>`, and a bullet gives the reason (the editor among several; the app reads the path to
  open Live, marked planned). wigley 2.16.0 → 2.16.1. Commit `dfe96e014`.

The comments in `contract.ts` and `manifest.ts`, the header comment of `main/start.ts`, and the live-view line of
`wigley-ai-gui/AGENTS.md`'s source layout land with the code in task 02.

## Mandatory Reads

- `~/wigley-agents/WigleyRepos.md`, then `wigley-ai-gui/AGENTS.md` (a 50k-token file: read § Architecture's bullets
  "A plugin", "A registration", "A disabled plugin", "A plugin talks", "A slot"; the `live-view/` entry of the source
  layout; § Review; § Running and testing through its end)
- `wigley-ai-gui/docs/features/live-view/design.md` (whole)
- No `CLAUDE*.md` and no `.claude/rules/*.md` exist in the `ai` repo or in `wigley-ai-gui/` (checked with `ls`).

## Design Overview

```
 Bash call of any agent in row R (lead or subagent; subagent calls carry R)
        |                                   |
  chat.entries put (R, entry)        chat.agentEvent toolStarted (R, toolUseId, replayed)
        |                                   |
        +------> playtest watch (main/playtest-watch.ts) <------+
                   live only: the entry's toolUseId has a toolStarted with replayed=false;
                   acts on the completion put, only when the result is not an error;
                   a list `replace` (restore) never acts; acts once per toolUseId
                   |
           parsePlaytestCommand(command)            (playtest-command.ts, pure)
                   |
        start {projectPath|null}                 stop {projectPath|null}
                   |                                |
   projectPath null -> log line, no call            |
                   |                                |
   LiveTools.playtestStarted(R, path)      LiveTools.playtestStopped(R, path)
     no pick for R -> show whole editor       app-opened pick for the same path -> delete it
     (no editor / no window: log, no pick)    agent pick, other path, no path -> leave it
                   |
            live-view.picks[R]  --> page Live section (unchanged)

 Agent show_live_view (success) -> pick becomes the agent's (app mark cleared)
 Agent hide_live_view / sessions.ended -> pick deleted, app mark cleared
```

### Decisions (settled with the user; verbatim)

1. Goal: the app opens a session's Live view on its own when that session starts a Unity playtest, so the user never
   has to ask for the screen share. It must work for any Unity project that uses the `unity` CLI: no project-specific
   (new-games) knowledge.
2. Open trigger: a Bash tool call from any agent of the session (the lead or a subagent; subagent calls arrive under
   the lead's row id) whose command runs `unity command editor_play` or `capture.py start`, seen when the call
   starts. Live calls only: a replayed or restored entry never opens the view. ("Seen when the call starts" is moved to
   "seen when the call succeeds": plan, Decided, "Act on success".)
3. Close trigger, only for a view the app opened itself: a Bash call running `unity command editor_stop`, the agent's
   `hide_live_view`, or the session ending.
4. The agent's pick always wins: the app opens the view only when the session has no pick; an agent
   `show_live_view` replaces an app-opened pick and the pick becomes the agent's, so a later `editor_stop` leaves it.
5. Project folder: only the command's `--project-path <dir>`. The agent names its editor in the command that starts
   the playtest; the app guesses no folder. A trigger command with no `--project-path` writes no pick, only a log
   line. The pool-clone and session-folder fallbacks are dropped. (Replaced by the user after the first draft.)
6. The app-opened view streams the whole editor window (show with no gameRect). The agent's later `show_live_view`
   with the Game View rect crops it; the playtest skill keeps that step.
7. No setting to turn it off.
8. Docs: design.md's "The agent alone starts and stops it" (lines ~16-20, 24) and Rejected line ~110 are rewritten to
   say the app also opens and closes it on playtest commands; the comments at contract.ts ~28-30 and manifest.ts
   ~3-6 and the live-view line in AGENTS.md's source layout are updated with the code.
9. A pure module in live-view (e.g. `playtest-command.ts`) turns a Bash command text into a playtest signal: start
   or stop, plus the `--project-path` when given, or none. Table-tested (chained commands like
   `a && unity command editor_play`, `--project-path` before/after, quoted paths, unrelated `unity command` calls
   give none, `capture.py stop` gives none).
10. The precedence rule (decision 4) lives inside LiveTools, the one module that owns the pick: it gains a show and a
    hide for playtest signals, and remembers which session picks the app set, beside its existing generation
    counter. The watch only translates entries into those calls.
11. The watch reads the full Bash command from the `chat.entries` list slot (the `toolStarted` event's summary is cut
    to 80 chars), following chat's own `noteBashCommand` pattern for telling live entries from replays. Verify that
    pattern and pin the exact guard in the task.
12. Superseded by the new decision 5: live-view reads no unity-pool slot and no `chat.session` folder, so its
    manifest's `reads` stay as they are.

### Decisions settled while planning (Decided)

- **The live guard (decision 11, pinned).** Chat's `noteBashCommand` uses chat's private `replay.isReplaying`, which
  no slot carries. The watch's equivalent: a Bash entry acts only when a `chat.agentEvent` with `replayed: false`,
  `event.type === 'toolStarted'`, `event.tool === 'Bash'` came for the same row id and `toolUseId`. A list `replace`
  change never acts. Each `toolUseId` acts at most once. Details in task 02.
- **Act on success.** The watch acts on a Bash entry when its result arrives and is not an error
  (`result !== null && !result.isError`), still paired with a live `toolStarted` (`replayed: false`) for the same row
  and `toolUseId`; a denied or failed call does nothing. This moves decision 2's "seen when the call starts" to "seen
  when the call succeeds", because `toolStarted` comes from the `tool_use` block before any permission answer, and a
  denied `editor_play` must not open the view (cold read, task 02).
- **Stop scope.** `editor_stop` closes the app-opened pick only when its `--project-path` equals the project the app
  pick was opened for (one trailing `/` ignored); a stop with no path or another path leaves it. So `PlaytestSignal`'s
  `stop` keeps its `projectPath`, and `LiveTools.playtestStopped` takes it.
- **Parser.** Split the command into segments on `&&`, `||`, `;`, `|` and newlines. A segment signals only when its
  program word (after leading `VAR=value` assignments) is `unity` or a path ending in `/unity`, followed by
  `command`; the first positional after it that is not a flag is the command name (`editor_play` start,
  `editor_stop` stop). Value-taking flags of `unity command` (`--project-path`, `--timeout`, `--port`, `--pid`,
  `--instance`, `--runtime`, `--runtime-path`, `--detail`, `--query`, `--tag`) consume the next token; redirections
  (`2>&1`, `>f`, `2>/dev/null`) are dropped. `capture.py start` signals when the program is `python`/`python3`(.x) or
  a path to one, the script token ends in `capture.py`, and the first positional after it is `start`.
  `echo unity command editor_play`, `(unity …)` subshells and `bash -c '…'` give no signal (out of scope). A missing
  or empty `--project-path` value gives the signal with no project path. Task 01 pins each rule with a table row.
- **Two concurrent app starts.** `playtestStarted` bumps the app counter at its start, so of two app shows waiting at
  once only the later can write: one pick, one log line (cold read, task 02).
- **The watch's id sets.** Per row the watch keeps a live set and a done set of `toolUseId`s, so each id acts at most
  once even when a second live `toolStarted` arrives; `replace` clears neither, since a live put can follow it;
  `delete` and the session's end clear both (cold read, task 02).
- **Self-test wait.** The live-view self-test's `picks.on` wait resolves only on a defined pick for the session's
  key, and the `show` call runs after the wait whether it resolved or timed out (cold read, task 03).
- **Rejected: Rung deep for 03.** A cold reader suggested it; its wait is small and bounded, and 02 holds the real
  concurrency, so 03 stays hard.
- **An app-opened pick may be the blocked pick.** With Screen Recording off, the app's show writes
  `{ kind: 'blocked' }` as the agent's would, so the user sees the line and the settings button; it counts as
  app-opened, so `editor_stop` deletes it.
- **A `--project-path` value is used as given.** A relative or `~` path reaches `LiveTools`, whose absolute-path check
  refuses it: no pick, one log line.
- **`capture.py command -- editor_play` is no trigger**: decision 2 names `unity command editor_play` and
  `capture.py start`; the playtest skill calls `unity command editor_play` directly.
- **Self-test: yes, through `open` and `problems`.** AGENTS.md § Running and testing asks for a self-test step for a
  key behaviour. The new behaviour is main-side: a real chat row's live Bash entry reaching live-view through the
  real chat plugin, which the unit tests fake. The fake harness gains a `fake: playtest` send text that runs
  `unity command editor_play --result-only --project-path '<the process's project folder>'`; the live-view self-test launches its session with that text, waits for
  the app-opened pick, then calls `show` with the Game View rect as before. Its page steps stay as they are: the page
  side (a whole-editor stream) is existing behaviour. Task 03.

### Out of scope

- Any change to `capture.py`, and to the `wigley:unity-playtest` skill past the docs-ahead commit (the skill keeps
  its `show_live_view` step).
- The page part, the layout, and `window-pick.ts`: the app's show uses the existing whole-window pick.
- A setting to turn the watch off (decision 7).
- `spike.md`: it records the spike's result as it was.

## File Structure

Existing files modified (all under `wigley-ai-gui/`):

- `src/plugins/live-view/main/live-tools.ts` — `LiveTools` gains `playtestStarted` and `playtestStopped`, and the
  app-opened mark (task 02)
- `src/plugins/live-view/main/start.ts` — wires the watch, the slot readers, and the self-test's new dep (tasks 02, 03)
- `src/plugins/live-view/manifest.ts` — the header comment (task 02)
- `src/plugins/live-view/contract.ts` — the `livePicksSlot` comment (task 02)
- `src/plugins/live-view/main/start.test.ts` — the watch and precedence tests (task 02)
- `src/plugins/live-view/main/selftest-script.ts` — launches with the playtest text, checks the app-opened pick (task 03)
- `src/shared/fake-agent-harness.ts` — `FAKE_PLAYTEST_TEXT` (task 03)
- `AGENTS.md` — the `live-view/` source layout entry (task 02)
- `docs/features/live-view/design.md` — planned marks dropped, stale lines fixed (task 04)
- `../wigley-ai-marketplace/plugins/wigley/skills/unity-playtest/SKILL.md` — its planned mark dropped (task 04)

New files:

- `src/plugins/live-view/playtest-command.ts` — the pure parser; beside `window-pick.ts`, the plugin's other pure
  module shared by no process in particular (task 01)
- `src/plugins/live-view/playtest-command.test.ts` — its table test (task 01)
- `src/plugins/live-view/main/playtest-watch.ts` — the watch: entries and events in, `LiveTools` calls out. Its own
  module so `start.ts` stays a wiring file and the pairing state has one owner (task 02)

Shared names (one producer each):

- `export type PlaytestSignal = { kind: 'start'; projectPath: string | null } | { kind: 'stop'; projectPath: string | null }`
  and `export function parsePlaytestCommand(command: string): PlaytestSignal | null` in `playtest-command.ts` (01)
- `LiveTools.playtestStarted(sessionId: string, projectPath: string): Promise<void>` and
  `LiveTools.playtestStopped(sessionId: string, projectPath: string | null): void` in `main/live-tools.ts` (02)
- `export const FAKE_PLAYTEST_TEXT = 'fake: playtest'` in `src/shared/fake-agent-harness.ts` (03)

Boundary rules:

- Only `LiveTools` reads or writes `live-view.picks` for a real session and holds the app-opened mark. The watch
  never touches the picks slot.
- `playtest-command.ts` imports nothing from the plugin or the contracts: text in, signal out.
- The watch reads no folder source but the command: no `chat.session`, no unity-pool import.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

Critical path: 01 → 02 → 03 → 04

### Wave 1
- [x] [Playtest command parser](01-playtest-command.md)

### Wave 2
- [x] [Playtest watch and the app's pick in LiveTools](02-playtest-watch.md) — after 01

### Wave 3
- [x] [Self-test runs a playtest command](03-selftest-playtest.md) — after 02

### Wave 4
- [ ] [Doc re-read](04-doc-re-read.md) — after 01, 02, 03
- [ ] [Final verification](05-final-verification.md) — after 01, 02, 03; run by `wigley:make` after its test gate

## Run log

Review base: c4cbc082a0f39eaa57c3550b3f50f3513872e0e2

### Groups
- 01 · hard · 16a017f9b · diff read: both Produces present in playtest-command.ts; wave 1 tsc --noEmit passes · concerns: tab is a separator, CR is not; TS narrowing through a const boolean
- 02 · deep · 74a7701c7 · diff read: playtestStarted, playtestStopped, createPlaytestWatch, PlaytestWatch present; wave 2 tsc --noEmit passes · concerns: commandOf copied from chat-sessions.ts (drift risk); tests rely on entries.on hearing puts after a late publish; table 6 agent-first row answers lists by index
- 03 · hard · b753dc8e5 · diff read: FAKE_PLAYTEST_TEXT exported, emitToolTurn takes the run, self-test waits on picks; wave 3 tsc --noEmit passes · concerns: problems copies live-tools pickText text; no test pins the toolStarted event of the fake tool turns
### Contract changes
### Rulings
- A missing or empty --project-path value keeps an earlier path (rule 4 "sets no path" read as no assignment) — no table row covers it — a stale path in one edge case · group 01 · group 01
- Bare redirection regex takes any fd digit (1>, 3<), same shape as the joined form — wider than the listed forms — none in practice · group 01 · group 01
- Table 2 preview row runs with no --project-path and asserts the log, since the preview code writes its own sample pick — the pick cannot be undefined there — the row checks the filter by log only · group 02 · group 02
- Shared lookup is a module-level lookUpPick returning {pick}|{error}; playtestStarted checks both generation and app counter though every generation bump also bumps the counter — matches the plan step 3 — none · group 02 · group 02
- The 10 s pick wait uses global setTimeout, as chat and docs self-test scripts do, rather than a Timers dep — the plan lists none — a fake-timer test of the script would need the seam · group 03 · group 03
### Review rounds
### Test gate
