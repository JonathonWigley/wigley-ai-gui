# 24 — One host per channel: a listen lock, and a shutdown that touches only its own record

Status: not started
Type: Task
Wave: 4 · Depends on: 02, 07
Rung: deep · concurrency between two host processes racing for one Unix socket, over the host's start and shutdown
Plan: [plan.md](plan.md)

Follow-up from `docs/features/followups.md` § Latent defects and tests: **Two hosts on one channel**. The scheduled
tasks feature raises its weight: a login start (task 18) and an app start can now start a host at the same moment, and
a second host beside a live one also loads the same pending file (task 07) and can fire a run twice.

Files:     modify `src/shared/local-channel/local-channel.ts` · test `src/shared/local-channel/local-channel.test.ts` ·
           modify `src/session-host/host-server.ts` · test `src/session-host/host-server.test.ts` ·
           modify `docs/features/session-host/design.md` (§ The host: the two limit bullets and the "owning the channel
           proves nothing" clause) ·
           modify `docs/features/followups.md` (removes the entry)

Consumes:  `host-server.ts` and `host-server.test.ts` as tasks 02 and 07 leave them (← 02, ← 07). Tree members:
           `listenOnChannel`, `connectToChannel`, `connectFoundNoListener`, `ChannelServer`
           (`local-channel.ts`); `startSessionHost`, `shutDown`, `writeRecord`, `sweepLogs`
           (`host-server.ts`); `SessionHostRecord` (`src/contracts/session-host-protocol.ts`).

Produces:  no new export. `listenOnChannel` keeps its signature; its behaviour on a socket path changes (Decisions).

Decisions:
- **The cause.** `listenOnceFree` checks for a live listener, removes the socket file, then listens. Two processes
  can pass the check together; the second's `rmSync` unlinks the first's socket, and both listen. A socket file
  removed by hand lets a second host pass the check beside a live one.
- **A lock for the server's life.** On a socket path (not a Windows pipe: a pipe in use already fails with
  `EADDRINUSE`), `listenOnChannel` takes `<channel>.lock` before the check, and holds it until `close()` resolves.
  The lock file holds the taker's pid. It is taken with an exclusive create (`openSync(lock, 'wx')`).
  - The lock exists and its pid runs (`process.kill(pid, 0)` succeeds or fails with `EPERM`): fail with the
    `EADDRINUSE` error `channelInUse` makes. So a socket file removed by hand no longer admits a second listener.
  - The lock exists and its pid does not run (`ESRCH`), or the file holds no pid: the lock is stale. Take it over so
    that two takers cannot both win. Write the race-free step as one private function with its reason in a comment.
    A suggested shape: rename the stale lock to a unique name, read the renamed file, and continue only when it
    still holds the stale pid that was read; then retry the exclusive create once. Any other outcome fails with
    `EADDRINUSE`.
  - `close()` deletes the lock only when it still holds this process's pid.
  - The lock adds no `node:` import outside what `local-channel.ts` already imports from `node:fs`. Its pid comes from
    `process.pid`; the module already reads `process`.
- **The relay channel too.** `src/plugins/sessions/main/relay/relay-server.ts` also calls `listenOnChannel`. It gets
  the lock with no change to its file. That is wanted: two app instances of one id must not share a relay channel.
- **Shutdown acts on its own record only.** In `startSessionHost`'s `shutDown`, before it removes
  `hostRecordFile(SESSION_HOST_PROTOCOL)`, read the record. Remove it only when its `pid` is `deps.pid`. A record that
  cannot be read is left in place. The socket file is the server's: `server.close()` removes it only for the lock
  holder, which this host is.
- **Log set-aside and pipe-log sweep** already run only after `server.listening` resolves true. With the lock, a host
  that listens is the only one, so they need no other change. Add a one-line comment saying so beside
  `diagnostics.setAsidePrevious()`.
- **Design doc.** Rewrite the two "known limits" bullets of `docs/features/session-host/design.md` § The host, and
  the clause "owning the channel proves nothing, since a socket file gone or a check-then-listen race gives a new
  host the channel beside a live one", to state the lock: one host per channel; a host that finds the lock held by a
  running pid exits as a host that finds the channel owned does. Keep the clause about an older host that may be
  draining, since a draining host of another protocol still runs.
- Test names follow each file's existing form.

GIVEN two `listenOnChannel` calls on one socket path in the same tick
WHEN both settle
THEN exactly one `listening` is true, and the other's `failed` got `EADDRINUSE`

GIVEN a live listener whose socket file was removed by hand
WHEN a second `listenOnChannel` on that path runs
THEN it fails with `EADDRINUSE`, and the first listener still accepts connections

GIVEN a lock file whose pid does not run, and no socket file
WHEN `listenOnChannel` runs
THEN it listens, and the lock holds its own pid

GIVEN a host whose record file now holds another pid
WHEN the host shuts down
THEN the record file stays

Tests:
- `local-channel.test.ts`: the first three GIVEN/WHEN/THEN over a temp folder, as the file's existing cases run. For
  the stale lock, write a pid that does not run (spawn and reap a short child, then use its pid). Add: `close()`
  deletes the lock; `close()` leaves a lock that another pid now holds. Break: a check-then-listen with no lock.
- `local-channel.test.ts`: two takers of one stale lock (call the private take-over through two
  `listenOnChannel` calls started in the same tick): exactly one listens.
- `host-server.test.ts`: the fourth GIVEN/WHEN/THEN, and the existing shutdown case still removes its own record.

Done when: `npm run lint` and `npm run typecheck` pass; `npm test` passes for the two test files above and for
`src/plugins/sessions/main/relay/relay-server.test.ts`. The follow-up entry "Two hosts on one channel" is
gone from `docs/features/followups.md`. No live check here: a real host start is checked in task 21.

Commit:    one commit for the group: "Session host: one listener per channel through a lock; shutdown removes only its own record".

## Proof

