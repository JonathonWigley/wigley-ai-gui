# Session host — plan

Feature: Session host · Implements: none · Ticket: none
Target: `main` (wigley-ai-gui) and `main` (wigley-ai-marketplace, task 03 only) · Written: 2026-11-03

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Agent sessions keep running through an app quit, a relaunch and `npm run install-app`. No turn stops, no tool call,
subagent or background shell is cancelled, and no queued message is lost. The relaunched app, often a newer
version, re-attaches each running session and shows it as if it had stayed open. This closes the follow-up **Keep
sessions running when the app closes** (`docs/features/followups.md` § Features).

## Architecture

Systems touched:

- **New: the session host** (`src/session-host/`): a detached process per app instance. It runs on the app's own
  binary as Node. It owns every agent process, logs both directions of each process's pipes, and ends idle processes
  while no app is connected.
- **New: the host client** (`src/main/session-host/`): the app's adapter behind the `SessionHost` contract.
- **Moved: the local channel transport** (`src/shared/local-channel/`), out of the sessions plugin's relay, shared by
  the relay server and the host.
- **Claude adapter** (`src/main/claude-code/`): the per-process state becomes a pure fold over pipe lines. Session
  processes run through the host. A new `attach` replays a pipe log.
- **Chat plugin** (`src/plugins/chat/`): re-attaches rows on restore, quit no longer ends processes, `chat.stopAll`,
  the `chat.keepIdleMinutes` setting, saved queued messages, replayed events.
- **Agents plugin** (`src/plugins/agents/`): skips replayed events in its log.
- **Sessions plugin** (`src/plugins/sessions/`): holds relay connects until chat has opened its restored rows, so
  a relay that reconnects right after a relaunch joins the owned row instead of opening an unowned one.
- **Packaging** (`forge.config.mts`, `scripts/install-*.mts`): the `RunAsNode` fuse on, a session host build entry,
  Windows per-version install folders. `install-app` stops waiting on the session host, which runs the same
  binary as the app (on both OSes).
- **The relay** (wigley-ai-marketplace `plugins/wigley/scripts/forms/`): holds an in-flight call across an app
  restart. Finds the Windows install in the newest `app-*` folder.

## Preconditions

Each was run at plan time. `wigley:make` runs them again before the first dispatch.

| Claim | Command (from the repo root named) |
|---|---|
| The `RunAsNode` fuse is off today | gui: `grep -n "RunAsNode\]: false" forge.config.mts` |
| Chat ends every process on quit | gui: `grep -n "chat.killAll()" src/plugins/chat/main/start.ts` |
| The harness takes an injected spawn | gui: `grep -n "export type ClaudeSpawn" src/main/claude-code/claude-code-harness.ts` |
| Main builds the harness with `spawn` | gui: `grep -n "createClaudeCodeHarness" src/main/main.ts` |
| The relay answers a dropped call with an error | marketplace: `grep -n "^APP_GONE" plugins/wigley/scripts/forms/relay.py` |
| The relay's Windows fallback is the fixed exe path | marketplace: `grep -n '"Programs", "wigley-ai-gui", "wigley-ai-gui.exe"' plugins/wigley/scripts/forms/start_app.py` |
| The marketplace plugin version is 1.14.0 (measured at plan time, re-verify; task 03 bumps from the version found) | marketplace: `grep -n '"version"' plugins/wigley/.claude-plugin/plugin.json` |
| Peer plans not yet run edit the same chat and harness files | gui: `ls -d docs/features/auto-compact/plan-* docs/features/session-clock/plan-* docs/features/session-groups/plan-*` |

The peer plans (auto-compact, session row clock, session groups) edit `chat-sessions.ts`, `open-sessions.ts`, the
Claude adapter and the fake harness. When one of them lands first, the implementer of tasks 05, 08 and 09 reads the
landed code and fits this plan's decisions to it. When a decision here conflicts with landed code, the implementer
reports it as a concern and does not guess.

## Docs written ahead

- wigley-ai-gui `abb19a9a`: `docs/features/session-host/design.md` (new), `docs/features/agent-chat/design.md`,
  `AGENTS.md`, `docs/keymap.md`.
- wigley-ai-gui `0b3d0266`: gap-fix edits to `docs/features/session-host/design.md` and
  `docs/features/agent-chat/design.md`.
- wigley-ai-marketplace `cbd8a9e`: `plugins/wigley/scripts/forms/README.md` § The relay.

The design doc is the source of truth for behaviour. Task 11 re-reads every doc above against the landed code.

## Mandatory Reads

- `AGENTS.md` (wigley-ai-gui): § Intent, § Architecture, the layer map, § Running and testing.
- `docs/features/session-host/design.md`: every task.
- `docs/features/agent-chat/design.md` § Agent harness seam, § Saved sessions, the queued messages passage: tasks
  05, 08, 09.
- `docs/keymap.md` § Adding a bind: task 09.
- wigley-ai-marketplace `AGENTS.md` and `plugins/wigley/scripts/forms/README.md` § The relay: task 03.
- No `.claude/rules/` folder and no nested `AGENTS.md` exists under `src/` (checked at plan time).

## Design Overview

### Flow (after the change)

```
 app start (main.ts)
   └─ createSessionHostClient ──connect──▶ host channel (session-host-v<N>)
        │  none answers → spawn <app binary> session-host.js, ELECTRON_RUN_AS_NODE=1, detached; wait for channel
        │  a lower-protocol host's record found → send `drain` to it (a newer host is never drained)
        ▼
   services.sessionHost ──▶ chat (list, setKeepIdleMinutes)       harness deps.host ──▶ spawn / attach
 
 chat restore
   for each saved record:
     host lists record.processId running, current version ─▶ harness.attach(start, processId, events)
         │    host returns { process, log }; fold replays log (effects off); events fired before attach
         │    resolves are replayed; then live lines
     host lists it running in another protocol's host, the list times out, or attach fails
         ─▶ row is unheld (task 09 decision 24): notice, sends refused until that process ends;
            a send or history read lists the host first and re-attaches when the process still runs
     otherwise ─▶ row rests (today's path)

 session host (own process)
   spawn ─▶ claude ⇄ stdin/stdout/stderr ─▶ pipe log <user data>/session-host/logs/<pipeLogFile(id)> {seq,dir,at,text}
   last stdout line matches idle rule and no client connected for keepIdleMinutes ─▶ endInput, kill after grace
   no process and no client ─▶ exit

 quit / install-app ─▶ chat detaches (no kill) ─▶ host keeps every process
 chat.stopAll (<Leader>:) ─▶ chat kills each owned process; rows rest
 relay call in flight when the app drops ─▶ relay polls 30 s, else starts app ─▶ re-sends the call
```

### Decisions

- A session host per app instance, a detached process running the app's own binary as Node (round 1).
- The host knows no harness. It spawns a command and logs both pipe directions with times (round 2, revised notice).
- The app re-attaches by replaying the pipe log through the newest harness code (round 2).
- The harness's per-process state is a pure fold over pipe lines; live and replay share the fold (design review).
- `hello`, `list` and `drain` and the pipe log format never change shape (round 2, older hosts).
- Idle sessions while no app is connected are ended after `chat.keepIdleMinutes`, default 60 (round 1).
- Quit always leaves sessions running. `chat.stopAll` on `<Leader>:` stops them (round 1, round 2).
- Queued messages are saved with the session record and sent after re-attach (round 3).
- Replayed events carry `replayed: true`; the agents log and chat's alerts skip them (round 2 notice).
- The relay holds an in-flight call across an app restart (round 1).
- App-made command messages (`/effort`, `/model` picks, and auto-compact's `compact()` when it lands) carry a uuid
  whose first group is `00000000-`, so a replay tells a control pick (no user entry) from a typed command (a user
  entry). The uuid is the app's own field on its stdin message (task 05).
- Replay matches live except where 05 names a limit: the "Interrupted again" notice (made by a call, not a line),
  agent definitions loaded before the replay, an `in` and `out` line that cross in transit (a fallback turn end; an
  interrupt crossing its result), and side inputs no pipe line records (the `settings.json` usage percent, saved
  replies), which attach reads again after the replay. When a turn ended while no app was attached, attach writes one
  context request (05, 08).
- Chat saves the controls and the `resume` value each process was launched with (`launchControls`,
  `launchResume`) and passes them to `attach` (task 09).
- Windows installs each build into its own `app-<short sha>` folder (round 1).
- A host that dies ends its processes; the app treats that as a process exit (round 3 notice).
- A drive run and the self-test stop their host's processes at teardown. A drive `restart` keeps them; only the
  run's final `quit` stops them, inside the parts' quit task after `disposeParts` settles (08).

### Out of scope

- The Codex adapter (its own follow-up). This plan keeps the host and the attach seam harness-agnostic.
- Showing an older host's session output live after a protocol change. Those rows show a notice and wait.
- A process that survives a machine reboot.

## File Structure

### Shared contracts (task 01 produces; every later task uses these names exactly)

`src/contracts/session-host.ts` (new):

```ts
export type PipeDirection = 'in' | 'out' | 'err';
// One line a hosted process read on stdin (`in`) or wrote (`out`, `err`), without its newline.
// `seq` counts from 1 per process; `at` is epoch ms.
export interface PipeLine { seq: number; dir: PipeDirection; at: number; text: string; }
// A stdout line whose top-level JSON `key` equals `value` ends a turn (Claude: { key: 'type', value: 'result' }).
export interface IdleRule { key: string; value: string; }
export interface HostedSpawn {
  id: string;
  command: string;
  args: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
  idleRule: IdleRule;
}
export interface HostedExit { code: number | null; signal: string | null; error: string | null; }
export interface HostedProcessEvents {
  line(line: PipeLine): void;     // live `out` and `err` lines only; `in` lines are logged, never echoed
  closed(exit: HostedExit): void; // once; `error` is set when the spawn failed
}
export interface HostedProcess {
  readonly id: string;
  write(text: string): void;      // one line; the host appends the newline and logs it as `in`
  endInput(): void;
  kill(signal: 'SIGTERM' | 'SIGKILL'): void;
  // Stops this subscriber's events; the process keeps running. A later `attach` to the same id is allowed
  // after a detach; a second `attach` while one subscriber is live replaces it (the old one gets no more events).
  detach(): void;
}
export interface HostedProcessInfo {
  id: string;
  startedAt: number;
  running: boolean;
  current: boolean;               // false: it lives in another protocol's host (an older one is draining)
}
export interface SessionHost {
  spawn(request: HostedSpawn, events: HostedProcessEvents): HostedProcess;
  // The whole pipe log so far, then live lines past its last seq through `events`.
  // Live lines start in a later macrotask than the one that resolves the promise, so a caller that replays `log`
  // in the continuation of its `await` has replayed the whole log before the first live line.
  // Null when no current-version host holds a running process with that id.
  attach(id: string, events: HostedProcessEvents): Promise<{ process: HostedProcess; log: readonly PipeLine[] } | null>;
  list(): Promise<HostedProcessInfo[]>;
  setKeepIdleMinutes(minutes: number): void;
  stopAll(): Promise<void>;
}
```

`src/contracts/session-host-protocol.ts` (new): the wire messages between client and host, newline JSON.
`SESSION_HOST_PROTOCOL` (a number, starts at 1). The frozen messages `hello`, `list`, `drain` and the frozen
`PipeLogRecord` (`{ seq, dir, at, text }`, one JSON object per log line) and `SessionHostRecord` (`{ protocol, channel,
pid }`, the `host-v<N>.json` file a client reads to find an older host) are marked frozen in their doc comments.
The same module owns every name in the host folder, frozen with the record: `HOST_LOGS_FOLDER`, `hostRecordFile`,
`hostLogFile`, `hostRecordProtocol` and `pipeLogFile` (a process id percent-encoded to a safe file name).
The rest: `spawn`, `write`, `endInput`, `kill`, `subscribe`, `unsubscribe`, `setKeepIdle`, `stopAll`, and the host's pushed
`line` and `closed` events. Task 01 writes the message types; tasks 06 and 07 use them.

`src/contracts/agent.ts` (modify):

- `AgentStart` gains `processId: string`: the hosted process id chat chooses for this start.
- `AgentHarness` gains
  `attach(request: AgentStart, events: AgentProcessEvents): Promise<AgentProcess | null>`. It attaches to the hosted
  process `request.processId`. Every event it fires before its promise resolves is replayed. Null when the host
  holds no running process with that id.
- `AgentProcess` gains `detach(): void`: it stops this process object's events and timers and leaves the hosted
  process running. Chat calls it on quit and on a chat plugin stop, in place of `kill`.
- `AgentHarness.history` gains a last parameter `before: number | null`: only entries the transcript recorded
  before that epoch ms; null reads them all.

`src/contracts/plugin.ts` (modify): `MainServices` gains `sessionHost: SessionHost`.

`src/plugins/chat/contract.ts` (modify): `ChatAgentEvent` gains `replayed: boolean`.

`src/shared/fake-session-host.ts` (new): an in-memory `SessionHost` for tests. Tests drive a process's output, its
close, a pre-filled log for `attach`, and what `list()` returns. It records writes, `endInput`, kills, detaches,
`setKeepIdleMinutes` and `stopAll`.

`src/shared/fake-agent-harness.ts` (task 08): its `attach` can fire events before it resolves, resolve null, or
reject, as a test sets.

Task 01 sets `replayed: false` at every `ChatAgentEvent` emitter in the tree (chat-sessions `processEvents` and
`emitSavedUsage`, and `chat-preview.ts`), so the tree compiles until task 09.

### Existing files modified

| File | Task | Change |
|---|---|---|
| `src/contracts/agent.ts`, `plugin.ts`, `src/plugins/chat/contract.ts` | 01 | the contract changes above |
| `src/shared/fake-agent-harness.ts`, `src/main/claude-code/claude-code-harness.ts`, `src/main/main.ts`, `src/plugins/chat/main/chat-sessions.ts`, `src/plugins/chat/main/preview/chat-preview.ts`, and the test fixtures typecheck names | 01 | compile stubs only (01-session-host-contracts.md § Decisions); 08 and 09 replace them |
| `src/plugins/sessions/main/relay/endpoint.ts`, `relay-server.ts`, `src/plugins/sessions/main/start.ts` | 02 | use `src/shared/local-channel/` |
| `scripts/check-layers.mts` | 02, 06 | rules for `src/shared/local-channel/`, `src/main/session-host/` and `main.ts`'s new import (02); `src/session-host/` (06) |
| `forge.config.mts` | 06 | `RunAsNode` fuse on; session host build entry |
| `src/main/claude-code/claude-code-harness.ts` | 05, 08 | pipe fold (05); host spawn, attach (08) |
| `src/main/claude-code/claude-controls.ts` | 05 | `CONTROL_COMMAND`, `controlOf` and `isChoice` move here for the fold |
| `src/main/drive/drive-commands.ts`, `drive-run.ts`, `scripts/drive.mts`, `.agents/skills/drive/SKILL.md` | 08 | `quit` takes `keepSessions`; a `restart` keeps hosted processes |
| `src/main/claude-code/transcripts.ts`, `past-sessions.ts` | 08 | history `before` cut through `readHistory` |
| `src/shared/fake-agent-harness.ts` | 08 | `attach`, `history` `before` |
| `src/main/main.ts` | 08 | build the host client; harness `host` dep; `services.sessionHost`; drive and self-test teardown |
| `src/plugins/chat/main/chat-sessions.ts`, `open-sessions.ts`, `start.ts`, `selftest-script.ts` | 09 | re-attach, record fields, quit detaches, stopAll, setting, replay flag, a stop-all self-test group |
| `src/plugins/chat/contract.ts` | 01, 09 | `replayed` (01); the `stopAll` invoke (09) |
| `src/plugins/chat/manifest.ts`, `src/plugins/keymap.ts` | 09 | `chat.stopAll`, `<Leader>:`, `keepIdleMinutes` |
| `src/plugins/chat/page/chat-commands.ts` | 09 | `chat.stopAll` page handler |
| `src/plugins/sessions/contract.ts`, `src/plugins/sessions/main/start.ts`, `src/plugins/sessions/main/relay/relay-server.ts` | 09 | `holdConnects`; the relay server awaits the hold before `connect` (02 edits `relay-server.ts` in wave 1) |
| `src/plugins/agents/main/start.ts` | 10 | skip replayed events in the log |
| `src/plugins/workflow/main/start.ts` | 10 | `apply` takes `replayed`; a replayed event starts no countdown |
| `scripts/install-steps.mts`, `scripts/install-app.mts` | 04 | Windows per-version folders; the running-app match skips the session host |
| marketplace `relay.py`, `start_app.py`, their tests, `plugin.json` | 03 | hold the call; newest `app-*` |

### New files

| File | Task | Why |
|---|---|---|
| `src/contracts/session-host.ts`, `session-host-protocol.ts`, `session-host-protocol.test.ts` | 01 | the seam and the wire, shared by host and client; the file-name tests |
| `src/shared/fake-session-host.ts` | 01 | the second adapter: tests |
| `src/shared/local-channel/` | 02 | one transport for the relay and the host |
| `src/session-host/` (`session-host.ts` its root, the process table, pipe log, idle timer, server) | 06 | the host process |
| `vite.session-host.config.mts` | 06 | its build entry, the same shape as `vite.main.config.mts` |
| `src/main/session-host/` (the client) | 07 | the app's `SessionHost` adapter |
| `src/main/claude-code/session-fold.ts` | 05 | the pure fold over pipe lines |
| `src/plugins/sessions/main/relay/connect-hold.ts` | 09 | holds relay connects until chat's restored rows are open, bounded at 5 000 ms |

### Boundary rules

- `src/session-host/` imports only `src/contracts` and `src/shared` (`src/shared/local-channel/` included). It never imports
  `electron`. `check-layers.mts` enforces it.
- The built host script is named `session-host.js` in dev and packaged builds. Task 04 tells the host apart from
  the app by that name on the process's command line, so tasks 06 and 07 keep it.
- Only `src/main/main.ts` names `createSessionHostClient`. Every other module receives `SessionHost`.
- No module outside `src/main/claude-code/` knows the Claude idle rule.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Session host contracts](01-session-host-contracts.md)
- [x] [Local channel transport](02-local-channel.md)
- [x] [Relay holds a call across a restart](03-relay-hold-call.md)
- [x] [Windows per-version install](04-windows-install-folders.md)

### Wave 2
- [x] [Claude adapter pipe fold](05-claude-pipe-fold.md) — after 01
- [x] [Session host process](06-session-host-process.md) — after 01, 02
- [x] [Session host client](07-session-host-client.md) — after 01, 02
- [x] [Agents log and workflow skip replayed events](10-agents-replayed.md) — after 01

### Wave 3
- [ ] [Claude adapter on the host](08-claude-on-host.md) — after 05, 07

### Wave 4
- [ ] [Chat re-attaches and survives quit](09-chat-reattach.md) — after 08

### Wave 5
- [ ] [Doc re-read](11-doc-re-read.md) — after 03, 04, 06, 09, 10

### Wave 6
- [ ] [Final verification](12-final-verification.md) — after 11

## Run log

Review base: 7f956435

### Groups
- 04 · beff2ef0 · diff read; typecheck clean in scripts/; install-steps tests pass; PowerShell and ps listers not run (live checks are the user's) · concerns: Windows PowerShell paths unrun on this Mac; rmSync on leftovers has no retry, so a flat migration may need a second run to clear; isStableAppProcess table has no row for a wrong file name in app-* or a deeper nested path
- 01 · ddfd4b33 · diff read; all Produces present; typecheck clean; both stub greps found · concerns: kill's comment leads the code until task 09 (chat still kills on quit); agents start.test.ts emits untyped chat.agentEvent without replayed, for task 10 to add; fake detach compares events by identity
- 02 · c7be320e · diff read; all Produces present; typecheck clean in its files; layer check clean; local-channel and relay tests pass · concerns: any connect rejection counts as stale, so a live listener refusing with EACCES or EAGAIN would lose its socket file; close test waits a fixed 20 ms; readLines assumes Buffer chunks and does not resume a paused stream; followups.md 323 and 331 name relay/endpoint.ts, for task 11
- 10 · 6b18de64 · diff read; typecheck clean in its files; agents and workflow start tests 25 passed · concerns: the new unlogged-events table drops the old proof that a preview event and a real event log side by side
- 03 · marketplace:524438dd · diff read; all Produces present; forms suite 63 tests OK (2 Windows-only skipped); manifest check run after commit; Windows lookup not run (user's check) · concerns: cancel-then-new-call lets that call start the app inside the 30 s window, harmless under the single-instance lock; narrow race leaves such a call needs_manual_open; _reconnecting stays True after close; refused-hello test at 2.0 s does not catch dropping the refusal stop
- 05 · 5b2ec6e5 · diff read; all Produces present; typecheck clean in claude-code; claude-code tests 404 passed · concerns: a send from idle gives one activity effect where the task says none (required by the activity sync); an error event with a pid now emits idle before ended, not on the task's list, named in the commit; HostedSpawn.id is sessionId until 08 switches to processId; a live init with no slash_commands replays a commands effect holding []; hasEmittedEnded guard cannot trigger today, 08 can drop it
- 07 · 4a9d6ee0 · diff read; Produces present; typecheck clean in its files; session-host client tests 27 passed; not yet run against task 06's real host · concerns: duplicate-id spawn differs from 01's fake (client replaces events, fake keeps the old ones live); current host's list, subscribe and stopAll have no reply timeout, so task 09's list timeout is the only bound; a detached entry stays in the client's map until host death or close; a corrupt middle log line takes the read-failure path
- 06 · b4b193de · diff read; typecheck clean in its files; session-host tests 58 passed; worker's packaged asar probe passed; not run on Windows · concerns: a pipe log create or append failure (disk full) ends the host and every session; a known message type missing fields throws and ends the host; close waits on stdio, so a grandchild holding the pipes keeps a process, its host and a stopAll reply past SIGKILL; exit-after-push not run live and a Windows pipe might lose the last closed; a dead older record costs up to 2000 ms each start; session-host-test-doubles.ts is an extra file beside production code
### Contract changes
### Rulings
- Marketplace review base is cbd8a9e; git fetch fails in this session (SSH key unavailable), so origin was not checked; neither main showed behind at the last fetch and nothing is pushed — a stale origin would surface at push · lead
- Cleanup deletes leftovers before older app-* folders, so a stale deleting-app-x cannot block a rename and print a false warning — only delete order differs if wrong · group 04 · group 04
- Windows lister sets PowerShell stdout to UTF-8 and quit tolerates a pid already gone — the match moved into Node; a real quit failure reads as the 15 s timeout · group 04 · group 04
- failNextSpawn closes the record through the close path, and a duplicate open id is checked before it — a failed process must not keep listing — only fake-based tests shift if wrong · group 01 · group 01
- HOST_LOGS_FOLDER and pipeLogFile comments also say frozen, since plan.md freezes every name in the host folder — two comments over-promise if wrong · group 01 · group 01
- A peer commit (3ae83602) landed on main after the review base, so the review range is this run's explicit commit list, not base..HEAD — a peer's commit would otherwise be graded as this run's · lead
- The liveness connect runs only for a socket file, not on every listen — relay-server.test.ts connects right after startRelayServer and an always-async listen failed 15 cases — a real stale socket listens a few ms late · group 02 · group 02
- mkdir, lstat and rm errors go through failed and listening false rather than throwing — listening never rejects and task 06 reads failures there — a relay whose socket folder cannot be made now logs where it threw · group 02 · group 02
- close during the liveness connect stops the listen, listening false and failed not called — otherwise a closed server would start listening · group 02 · group 02
- agentLog_UnloggedEvents asserts agents.sent on both rows, where the task names only the replayed row — keeps the table free of a per-row branch · group 10 · group 10
- The poll waits one reconnect_poll before its first try — caps an app that accepts then drops at two connects a second — a restart already listening is seen up to 0.5 s later · group 03 · group 03
- The cancelled-call test sends the second call before the cancel, the spec's order flakes when a poll check lands between them — the same rule is proved · group 03 · group 03
- foldUsageInput does not run advanceFold first — the task gives that to foldPipeLine only — a past-deadline grace ends at the next line or timer with the same stamp · group 05 · group 05
- The interrupt control response no longer syncs activity itself — every fold ends with the sync — an activity effect could come later within one fold if wrong · group 05 · group 05
- exitText and exitError take signal: string | null — HostedExit.signal is a string · group 05 · group 05
- setKeepIdleMinutes while connecting stores the value and the new connection's first message carries the latest — the host sees one setKeepIdle, same end state · group 07 · group 07
- close() flushes with destroySoon and resolves once each socket closes, so a drain or unsubscribe reaches the host — a stopped host with a full buffer could hold close() open, so task 08 bounds it at quit if it awaits it · group 07 · group 07
- A spawn of an id already held replaces the events like an attach, and the host's refusal closed goes to the new events · group 07 · group 07
- The older-host sweep on connect skips drained records and never connects to a newer one — a stale record is deleted only by the next list() · group 07 · group 07
- A process's idle moment counts only on a busy-to-idle change, so a second result line does not restart the keep window — a process could end slightly earlier than a refreshing reading · group 06 · group 06
- A child error before it ran reads as child.pid undefined; an error with a pid goes to the diagnostic log and close still closes it — such a child that never closes would stay in the table · group 06 · group 06
- A synchronous spawn throw closes that id and removes its log, since a throw would end the host and every session · group 06 · group 06
- Keep window delay is capped at 2^31-1 ms, since setTimeout fires at once past it — a window above 24.8 days ends at 24.8 days · group 06 · group 06
- The uncaught handler and listen failure write the diagnostic log even in a host that does not own the channel — a stray line in a live host's log if wrong · group 06 · group 06
### Review rounds
### Test gate
