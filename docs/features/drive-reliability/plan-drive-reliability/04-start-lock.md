# 04 — Dev drive and self-test starts take one lock

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     create `scripts/start-lock.mts` · test `scripts/start-lock.test.mts` · modify `scripts/drive.mts` ·
           modify `scripts/selftest.mts`
Consumes:  `start`, `spawnApp`, `waitForDriveFile`, `isAlive`, `START_TIMEOUT_MS`, `POLL_MS` in `scripts/drive.mts`
           (tree)
Produces:  `export async function takeStartLock(lockFile: string, options: StartLockOptions): Promise<StartLock>` in
           `scripts/start-lock.mts`
           `export interface StartLock { release(): void }` in `scripts/start-lock.mts`
           `export interface StartLockOptions { timeoutMs: number; pollMs: number; isAlive(pid: number): boolean; onWait(holder: number): void }`
           in `scripts/start-lock.mts`
Decisions: a lock under `.drive/`, held from spawn until the app is up (round 2, choice 1) · packaged starts skip it,
           since they never touch `.vite/build` · the self-test takes the same lock (decided while writing the docs:
           `npm run selftest` is an `electron-forge start` too)

## Behaviour

- The lock file is `.drive/start.lock` and always holds its taker's pid as text: the taker writes its pid to
  `.drive/start.lock.<pid>`, then `linkSync`s that file to `.drive/start.lock` (`EEXIST` means held), then unlinks
  the temp file. So no taker ever sees the lock file without its pid, and two starts in the same second cannot both
  take it. `.drive/` is made when missing.
- `takeStartLock`:
  - creates the file and returns a lock whose `release` deletes it (a missing file on release is fine)
  - when the file exists and its pid is alive by `options.isAlive`, calls `onWait(pid)` once, then polls every
    `pollMs` until it can create the file
  - when the pid is not alive, or the file holds no pid (only a corrupt file can), deletes the file and tries again
    (a crashed holder's lock)
  - rejects after `timeoutMs` with `Another dev start (pid <pid>) held .drive/start.lock for <s> s; if no start is
    running, delete .drive/start.lock`
- `drive.mts` `start`: for a dev start (`!options.packaged`) takes the lock before `spawnApp` and releases it in a
  `finally` once `waitForDriveFile` returns or throws. The lock's `isAlive` is the one moved into `start-lock.mts` (below); `timeoutMs` is
  `START_TIMEOUT_MS`; `pollMs` is `POLL_MS`; `onWait` prints `Waiting for another dev start (pid <pid>) to finish`.
  `restart` reaches it through `start`.
- `selftest.mts`: takes the lock before spawning forge, with its own named constants `LOCK_TIMEOUT_MS = 120_000` and
  `LOCK_POLL_MS = 250` (the self-test's own wait policy, not drive's), and releases it at the first output line
  containing `[selftest]`, or when the child closes or errors, whichever comes first. Its `onWait` prints the same
  `Waiting for another dev start (pid <pid>) to finish`; on a lock timeout it prints the error, sets
  `process.exitCode = 1` and never spawns forge.
- `isAlive` moves from `drive.mts` into `start-lock.mts` as an export, and both CLIs import it; drive.mts's other
  callers (`stop`, `waitForExit`) use the import. The lock's pid is the taking CLI's `process.pid`.

GIVEN no lock file WHEN `takeStartLock` runs THEN it creates the file holding the pid and `release` removes it
GIVEN a lock file whose pid is alive WHEN `takeStartLock` runs and the holder releases after two polls THEN it calls
`onWait` once with that pid and then takes the lock
GIVEN a lock file whose pid is not alive WHEN `takeStartLock` runs THEN it takes the lock without waiting
GIVEN a lock held past `timeoutMs` WHEN `takeStartLock` runs THEN it rejects naming the holder's pid
GIVEN two `takeStartLock` calls started together with live pids WHEN both run THEN exactly one takes the lock and the
other waits until it is released

Tests:     the five cases in `scripts/start-lock.test.mts` (Vitest already runs `scripts/*.test.mts`: re-verify with
           `npm test -- scripts/drive-args.test.mts`), each in a temp folder under `os.tmpdir()` with a fake
           `isAlive` and small `pollMs` / `timeoutMs`
Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above. Two concurrent dev starts
           are task 12's live check.
Commit:    one commit for the group

## Proof

Commit a976d99 · proof: diff read matches spec; takeStartLock, StartLock, StartLockOptions present; typecheck passes · concerns: stale-lock clear is not atomic (two takers vs one dead holder can delete a fresh lock); temp file name shared within one process, safe only while write/link/unlink stay synchronous; a throwing runSelfTest leaves the lock to be cleared as a dead holder's
