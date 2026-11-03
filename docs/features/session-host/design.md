# Session host

**Contents**

- **Intent** — sessions keep running through a quit, a relaunch and `install-app`.
- **Vocabulary** — session host, hosted process, pipe log, replay, drain.
- **Flow** — start, quit, relaunch and re-attach, idle end.
- **The host** — what it does, what it knows nothing about, its folder, channel and lifetime.
- **Protocol** — the operations, which of them never change, and the pipe log format.
- **Re-attach** — replay through the harness's pipe fold, the history cut, replayed events, queued messages.
- **Older hosts** — drain after an update that changed the protocol.
- **Platforms** — the RunAsNode fuse, macOS, the Windows per-version install.
- **Rejected approaches** — the host running the harness, waiting for turns on quit, auto-continue.

## Intent

The user restarts and updates the app while agents work. A quit, a relaunch or an `install-app` stops no turn,
cancels no tool call, subagent or background shell, and loses no queued message. The relaunched app — often a newer
version — shows each session as if it had stayed open. A machine reboot or a host crash is the one case that still
ends a turn; it falls back to the resting row and `--resume`, as before this feature.

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
 turn ends while no app is connected ──▶ idle timer (chat.keepIdleMinutes) ──▶ host ends the process
 host has no process and no app ──▶ host exits
```

## The host

- The host spawns a command with args, folder and environment, writes lines to its stdin, closes its stdin, kills
  it, and logs every pipe line. It knows no harness: the Claude adapter, and a Codex adapter later, hand it a command
  and one **idle rule** (a top-level JSON key and value that marks a stdout line as the end of a turn, for Claude
  `"type": "result"`).
- A process is **idle** when its last stdout line matches the idle rule, and busy after any later line. While no app
  is connected, an idle process is ended once the keep window has passed since the later of its turn end and the
  app's last disconnect: stdin closed, then SIGTERM after a 3 s grace, then SIGKILL after 3 s more. The app sends
  the window (`chat.keepIdleMinutes`, default 60, the prompt cache's life) on connect and on each change.
- The host's folder is `session-host/` in the app instance's user data folder (the self-test's: in its temporary
  home, deleted at its teardown): the pipe logs in `logs/`, the channel's record `host-v<protocol>.json` and the
  host's own log. A pipe log is deleted when its process closes; a host that starts also deletes each log it holds no
  process for, unless a host of another protocol answers. Its channel is a Unix socket on macOS and a named pipe on Windows, through the same transport the relay
  channel uses, named with the protocol version so two protocol versions never share a channel.
- The app starts the host with its own binary as Node (`ELECTRON_RUN_AS_NODE=1`), detached, with no stdio, and
  waits for its channel. The host exits once it holds no process and no app is connected.
- A host that dies takes its processes with it: each one's pipes close and it exits. The app treats that as a
  process exit.
- A drive run and the self-test end their host's processes at teardown, since their runs are thrown away. A drive
  `restart` keeps them, so a drive run can check re-attach; only the run's final quit ends them.

## Protocol

Newline-delimited JSON over the channel. `hello`, `list` and `drain` keep their shape in every protocol version, so
any app can drain any older host. The pipe log format is frozen the same way.

- `hello` — the host's protocol version.
- `list` — each hosted process: id, start time, running or its exit code and signal, its pipe log path.
- `drain` — end each process at its turn end, refuse new ones, exit once empty.
- `spawn`, `write`, `endInput`, `kill`, `subscribe`, `unsubscribe`, `setKeepIdle`, `stopAll` — the rest, which may change with the
  protocol version.

A pipe log line is `{ seq, dir, at, text }`: `seq` counts from 1 per process, `dir` is `in`, `out` or `err`, `at` is
epoch ms, `text` the line without its newline. On attach the app subscribes first, reads the log, then takes live
lines past the last `seq` it read.

## Re-attach

- The harness keeps a session's state as a pure fold over its pipe lines, both directions. Live, each line the
  harness writes and each line it reads goes through the fold, and the fold's effects (writes, timers, events) run.
  On attach the fold replays the log with its effects off, then goes live. Replay and live share one fold, so they
  agree except for what no pipe line records (a notice the app made from a call, such as "Interrupted again").
- A re-attached row shows the transcript up to its process's start time, then the replayed entries, so no entry
  shows twice: transcript entries and live entries have different ids.
- A row whose process runs but cannot be attached — it lives in another protocol's host, the host list timed out, the
  attach failed, or its profile is missing from chat's profiles setting — is **unheld**: it refuses a send until that process ends, and before a send or a history read
  chat lists the host again and re-attaches when it can, so a session never runs two processes.
- Events a replay emits are flagged `replayed`, so the agents log appends nothing twice and no alert fires for a
  turn that ended while the app was closed. The row still shows the session's current state.
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
