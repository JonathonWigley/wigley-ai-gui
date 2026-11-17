# Session host

**Contents**

- **Intent** — sessions keep running through a quit, a relaunch and `install-app`.
- **Vocabulary** — session host, hosted process, pipe log, replay, drain.
- **Flow** — start, quit, relaunch and re-attach, idle end.
- **The host** — what it does, what it knows nothing about, its folder, channel and lifetime, what a host death leaves, its known limits.
- **Protocol** — the operations, which of them never change, and the pipe log format.
- **Re-attach** — replay through the harness's pipe fold, the history cut, replayed events, queued messages.
- **Older hosts** — drain after an update that changed the protocol.
- **Platforms** — the RunAsNode fuse, macOS, the Windows per-version install.
- **Rejected approaches** — the host running the harness, waiting for turns on quit, auto-continue.

## Intent

The user restarts and updates the app while agents work. A quit, a relaunch or an `install-app` stops no turn,
cancels no tool call, subagent or background shell, and loses no queued message. The relaunched app — often a newer
version — shows each session as if it had stayed open. A machine reboot or a host death is the one case that still
ends a turn: the row rests, the next host ends what the dead one left (§ The host), and the next message resumes the
session under it.

## Vocabulary

- **Session host** — one detached process per app instance (stable, dev, self-test, drive run) that owns every
  agent process the app starts. It outlives the app.
- **Hosted process** — one agent process the host owns, keyed by an id the app chooses.
- **Pipe log** — the host's append-only record of every line a hosted process read on stdin or wrote on stdout or
  stderr, each with its direction and time.
- **Replay** — the harness reading a pipe log from its first line to rebuild a session's state, writing nothing.
- **Drain** — telling a host to end each process at its turn end, take no new process, and exit once empty.

## Flow

```
 app start ──connect──▶ session host (start it detached when none answers)
     │                       │ owns: claude ⇄ stdin/stdout/stderr, pipe log per process
     │ chat restores rows    │
     ├─ host lists process P live for row R
     │    └─ harness.attach(R's start, P) ── replay P's pipe log ──▶ state as live; then live lines
     └─ no live process ── row rests (today's path, notice when its turn was running)

 quit / install-app ──▶ app disconnects; host keeps every process running
 chat switched off live ──▶ chat's stop detaches its processes as a quit does; the app stays connected and the host keeps them
 turn ends while no app is connected ──▶ idle timer (chat.keepIdleMinutes) ──▶ host ends the process
 host has no process and no app ──▶ host exits
 host dies ──▶ rows rest; next host ends what its record left ──▶ only then serves a spawn
```

## The host

- The host spawns a command with args, folder and environment, writes lines to its stdin, closes its stdin, kills
  it, and logs every pipe line, less the dropped keys below. It knows no harness: the Claude adapter, and a Codex adapter later, hand it a command
  and one **idle rule**: a top-level JSON key, the value that marks a stdout line as the end of a turn (for Claude
  `"type": "result"`), and the values of that key that start a turn on each pipe (for Claude `user` on stdin,
  `assistant` and `stream_event` on stdout, the last for a turn Claude starts by itself after a background task).
- The adapter also hands it **dropped keys**: JSON key paths from a stdout line's root (for Claude, the settings copies
  in one control reply, which hold the profile's `env` values). The host drops them from the line before it logs or
  delivers it, so a replay reads what a live subscriber read. It searches each line for the quoted last key and parses
  only on a hit; a line that holds no such path or is not JSON passes byte for byte.
- A process starts **idle**, reads busy on a line that starts a turn, and turns idle on a stdout line that ends one.
  Every other line leaves the state alone, on any pipe and whatever its shape, so a `system` line after a mode change
  or from a start hook, or the context request and its answer, keeps no process alive. While no app is connected, an
  idle process is ended once the keep window has passed since the later of its turn end and the app's last disconnect:
  stdin closed, then SIGTERM after a 3 s grace, then SIGKILL after 3 s more. The app sends the window
  (`chat.keepIdleMinutes`, default 60, the prompt cache's life) on connect and on each change. The host sees only pipe
  lines, so a background shell that stays silent past the window ends with its process, and so does a background
  subagent that has printed only `system` lines since the turn's `result`; one whose own `assistant` lines have reached
  stdout reads busy until the `result` of the turn its end starts. A process ending this way, or through a drain, lists
  as not running and refuses an attach: its stdin is closed, so its row rests and the next message resumes the session.
- The host outlives its logs: a pipe log that cannot be created fails only that spawn; one whose append fails stops
  appending, keeps delivering lines live, and refuses an attach, since it can no longer rebuild the state, so the
  process runs on with its row unheld. That holds after a relaunch too: such a process cannot be re-attached, so its
  row stays unheld until Stop all or the keep window ends it.
- The host's folder is `session-host/` in the app instance's user data folder (the self-test's: in its temporary
  home, deleted at its teardown): the pipe logs in `logs/`, the channel's record `host-v<protocol>.json`, each host's
  own record of its children `host-v<protocol>.<pid>.children.json`, and the host's own log `host-v<protocol>.log`. When
  an earlier host wrote a line to that log, the next host renames it to `host-v<protocol>.previous.log`, so a crash
  report outlives the restart that follows it. A pipe log is deleted when its process closes; a host that starts also deletes each log it holds no
  process for, unless a host of another protocol may be listening: one that answers, stays silent or denies the connect
  keeps them, and only a record whose connect proves no listener does not. Its channel is a Unix socket on macOS and a named pipe on Windows, through the same transport the relay
  channel uses, named with the protocol version so two protocol versions never share a channel.
- The app starts the host with its own binary as Node (`ELECTRON_RUN_AS_NODE=1`), detached, with no stdio, and
  waits for its channel. The host exits once it holds no process and no app is connected.
- A host that dies does not take its processes with it. The app treats the lost connection as each process's exit, so
  its row rests, but a `claude` in the middle of a tool can finish the tool and write to its session, beside whatever
  resumes that session. What closes that:
  - A host that throws sends each child SIGTERM on its way down. A host killed outright sends nothing.
  - Each host keeps its own pid and start time, and its children's pids, start times and commands, in its own children
    record, replaced whole from a child's spawn, once the OS has reported it, to its close. Only its writer changes a
    children record while that writer may run, so no host can delete or overwrite another's.
  - A new host, once it owns the channel, reads every protocol's children record, so a protocol bump leaves no orphan.
    It compares each record's writer with what `ps` or PowerShell reports for that pid. A writer that still runs keeps
    its children and its record, and the new host logs it: owning the channel proves nothing, since a socket file gone
    or a check-then-listen race gives a new host the channel beside a live one, and an older host may be draining. A
    new host that cannot ask the OS, or cannot read a record, leaves that record the same way, for a later host. A session
    whose process runs under such a writer can run a second process beside it.
  - Once a record's writer is gone, its pid unused or reused, the new host ends what the record left and removes it:
    SIGTERM, then SIGKILL after 3 s, about 6 s at most, on macOS and Windows alike through the platform's kill (on
    Windows either signal ends the process at once). Before each signal it compares the recorded start time with what
    `ps` or PowerShell reports, since a pid with the same start time is the same process whatever its command has
    become through an exec or a retitle; the recorded command is kept for the log. A pid it cannot confirm is left
    alone and logged. A process left alone this way can still write beside a resumed one.
  - Until that ends the new host answers only `hello`, `list`, `subscribe` and `setKeepIdle`, each of which finds an
    empty table. `list` so answers empty though a `spawn` may be held, so a relaunch inside the hold can rest a row beside
    a process about to start. Every other message waits in order and so does the exit rule, so no `spawn` runs beside a
    leftover. A resume always goes through a new host, and that host's start ends the leftovers even when no resume ever
    comes. The leftovers' pipe logs go with that host's log sweep.
  - Children are not started `detached`, and the end reaches only the recorded process: a tool the orphan was running
    may outlive it.
- Two known limits come with a new host that owns the channel beside a live one, which only a socket file gone or a
  check-then-listen race reaches:
  - The new host renames the live host's log too. Both hosts then append to `host-v<protocol>.log`, so a line of the
    live host can sit in either file.
  - A host of the same protocol that exits still runs its `shutDown`, which removes the channel and the record by path,
    and those are now the newer host's. The newer host keeps the clients it holds, and the next app finds no channel
    and starts another host beside it.
- A drive run and the self-test end their host's processes at teardown, since their runs are thrown away. A drive
  `restart` keeps them, so a drive run can check re-attach, and `drive quit --keep-sessions` keeps them with the run's
  home and user data, so `start --run <id>` brings the run back. Any other quit of a running app ends them. A plain
  `quit` of a kept run, whose app is gone, refuses while its host may be listening: `start --run <id>` then `quit` ends it.

## Protocol

Newline-delimited JSON over the channel. `hello`, `list` and `drain` keep their shape in every protocol version, so
any app can drain any older host. The pipe log format is frozen the same way, and so are the children record's name and
shape, so any host can end what any other left.

- `hello` — the host's protocol version.
- `list` — each hosted process: id, start time, running (false once it is ending) or its exit code and signal, its
  pipe log path.
- `drain` — end each process at its turn end, refuse new ones, exit once empty.
- `spawn`, `write`, `endInput`, `kill`, `subscribe`, `unsubscribe`, `setKeepIdle`, `stopAll` — the rest, which may change with the
  protocol version.

Each hosted process's OS pid reaches the app: `subscribe`'s reply carries `pid` (null when it has none), and the host
sends the connection that spawned a process `{ type: 'spawned', id, pid }` once the OS reports it (both since
protocol 3). `HostedProcessEvents.spawned(pid)` hands it to the spawner and `HostedProcess`
exposes it; the harness adapter passes it up, and chat publishes it as `pid` on the session's `chat.session` entry,
null while no process runs (`docs/features/system-stats/design.md` § Session processes).

A pipe log line is `{ seq, dir, at, text }`: `seq` counts from 1 per process, `dir` is `in`, `out` or `err`, `at` is
epoch ms, `text` the line without its newline. On attach the app subscribes first, reads the log, then takes live
lines past the last `seq` it read.

## Re-attach

- The harness keeps a session's state as a pure fold over its pipe lines, both directions. Live, each line the
  harness writes and each line it reads goes through the fold, and the fold's effects (writes, timers, events) run.
  On attach the fold takes a resumed process's saved replies first, then replays the log, both with its effects off,
  then goes live. The attach then writes what the replay shows the process is owed: a refusal for each host request
  left unanswered while no app was attached, and the context request. Replay and live share one fold, so they
  agree except for what no pipe line records (a notice the app made from a call, such as "Interrupted again") and the
  order of an `in` and an `out` line that crossed.
- `list` and `attach` reject when they could not ask a host (one did not start, dropped or stayed silent past the reply
  limit); `[]` and a null attach mean only what a host answered, so a row never rests on a process it could not check.
- A re-attached row shows the transcript up to its process's start time, then the replayed entries, so no entry
  shows twice: transcript entries and live entries have different ids.
- A row whose process runs but cannot be attached — it lives in another protocol's host, the host list timed out, the
  attach failed, or its profile is missing from the profiles its harness declares — is **unheld**: it refuses a send until that process ends, and before a send or a history read
  chat lists the host again and re-attaches when it can. `resume` lists the host first too: a process of the session
  running in the current host (the process id chat last knew for that session, or an id starting with its host session
  id) has the row open and attach to it, and one in another app version or a list that rejects
  refuses the resume. So a session never runs two processes, past those § The host names: a process left alone, a
  live host's child beside a new host, and a relaunch inside a new host's hold, when `list` answers empty.
- Events a replay emits are flagged `replayed`, so the agents log appends nothing twice and no turn-finished mark fires for a
  turn that ended while the app was closed. What a process that exits during the attach fires for that exit, its
  `sessionEnded` included, is not: that exit is real, so the agents log closes. The row still shows the session's current state.
- Chat saves each session's queued messages with its record. A re-attached row shows them again and sends the oldest
  once its turn has ended, as a live queue does.
- A permission prompt or form round waiting when the app quit stays waiting: the relay keeps the call and sends it
  again to the relaunched app (`wigley-ai-marketplace`, forms README § The relay).

## Older hosts

After an update that changed the protocol, the new app finds the older host's channel, sends it `drain`, and starts
its own. A newer protocol's host is never drained: an older app that finds one lists its processes as not current and
leaves them running. A row whose process lives in another protocol's host shows a notice that it is finishing in
another app version and refuses a send until that process has ended; it then rests and resumes under the new host on
the next message.

## Platforms

- The packaged app turns the `RunAsNode` fuse on, so its binary can run the host.
- macOS: `install-app` swaps the bundle while the host keeps running from the old one; a running binary survives
  its file being replaced.
- Windows: a running exe locks its folder, so `install-app` installs each build in its own folder under
  `%LOCALAPPDATA%\Programs\wigley-ai-gui\` and points the Start menu shortcut at the newest. An older folder is
  deleted once no host runs from it. The relay's `start_app` picks the newest folder.

## Rejected approaches

- **The host runs the harness**, the app a remote view of each session: the socket protocol would be the whole
  `AgentProcess` contract, which changes often, so after most updates running sessions could only drain.
- **Quit waits headless for running turns**: every restart and update waits on the longest turn.
- **Auto-continue on relaunch through `--resume`**: the turn's in-flight tool call, subagents and shells are lost.
