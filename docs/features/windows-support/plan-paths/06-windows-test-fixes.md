# 06 — Windows-only test and self-test fixes

Status: not started
Type: Batch
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     test `src/plugins/sessions/main/relay/relay-server.test.ts` · test `src/main/files/node-files.test.ts` · test `src/main/login-shell-path.test.ts` · modify `src/main/selftest.ts` · modify `src/main/main.ts`
Consumes:  `channelPath(platform, home, username, tempDir)` in `src/plugins/sessions/main/relay/endpoint.ts` (exists)
Produces:  none (test and failure-path changes only)
Decisions: tests choose their behaviour by what the machine can do (a pipe or a socket file, a symlink, a `/bin/sh`), not by a name check of the OS, and the relay test takes its channel from the production `channelPath` so it proves the named pipe on Windows (round 1 scope: the Windows test failures) · a test asserts what the `Files` contract promises (a rejection and the files left unchanged), not the macOS errno, since `src/contracts/files.ts` promises only `ENOENT` (Decided) · the self-test always exits, even when its cleanup throws (Decided)

## Items

1. **Relay server test (15 Windows failures)** — `start(...)` takes its channel from
   `channelPath(process.platform, dir, 'selftest', dir)` over the test's `mkdtemp` folder, in place of
   `path.join(dir, 's.sock')`, so it is a named pipe on Windows and a socket file elsewhere (the server already
   skips `mkdirSync` and the stale-file `rmSync` for a pipe, `relay-server.ts:161`). The `leftover` case writes its
   stale file only for a file channel. `listens over a socket file a crashed run left behind` runs only when the
   channel is a file path: `it.skipIf(<channel is a pipe>)`, deciding it by the channel string's `\\.\pipe\` prefix
   from one probe `channelPath` call at file load. Keep the macOS socket path within its 104-byte cap: the
   `wr-` temp folder stays short, and `channelPath` falls back by itself when it does not fit.
2. **Node files test (7 Windows failures)** — probe once at file load whether this process can create a symlink
   (a `symlinkSync` in a fresh temp folder; `EPERM` means no, as on Windows without Developer Mode), and mark the 5
   symlink tests `it.skipIf(!canSymlink)`: `stat_FileFolderAndLink_IsFolderAndIsLink`, `stat_DanglingLink_Null`,
   `realPath_Symlink_ReturnsTarget`, `rename_DestinationIsBrokenSymlink_RejectsAndKeepsBoth`,
   `rename_Symlink_MovesTheLinkItself`. Rename `rename_DestinationParentIsFile_RejectsWithEnotdir` to
   `rename_DestinationParentIsFile_RejectsAndKeepsSource` and `write_OntoAFolder_RejectsWithEisdir` to
   `write_OntoAFolder_RejectsAndKeepsFolder`: each asserts the call rejects and the files on disk are as before,
   dropping the `errorCode(...)` assertion (Windows gives `EINVAL` and `EPERM` for them, measured at plan time).
3. **Login shell PATH test (3 Windows failures)** — the 3 tests that write and spawn a `#!/bin/sh` script
   (`reads the PATH the shell prints between the markers`, `resolves null within the cap and kills the child that
   holds stdout open`, `resolves null within the cap when killing the group fails with EPERM`) run only when
   `existsSync('/bin/sh')`: `it.skipIf(!hasPosixShell)`. The module itself runs only when launchd is the parent
   (`main.ts`), so a machine with no `/bin/sh` never reaches it.
4. **Self-test exit (hang on Windows)** — `exitSelfTest` in `src/main/selftest.ts` calls `app.exit(code)` in a
   `finally` around `cleanUp()`, and a cleanup that throws writes `[selftest] cleanup failed: <errorText>` to stderr
   without changing the exit code. `cleanUpSelfTest` in `src/main/main.ts` (line ~268) removes the temp home with
   `rmSync(tempHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })`: Node retries `EBUSY`,
   `ENOTEMPTY` and `EPERM`, which Windows returns while a watcher or the page still holds a file in the home.

GIVEN this Windows machine WHEN `npx vitest run` runs THEN `relay-server.test.ts`, `node-files.test.ts` and `login-shell-path.test.ts` pass, the skipped tests reported as skipped
GIVEN the self-test's cleanup throws WHEN the self-test ends THEN the process exits with the self-test's result code

Tests:     the changed tests above; on macOS every changed test still runs (no skip fires there), which the final verification task lists for the user
Approach:  item 4 has no unit test: `selftest.ts` drives Electron's `app`. Task 08 checks it live (`npm run selftest` exits).
Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the three test files; `npx vitest run` shows no failure in them on Windows
Commit:    one commit for the group

## Proof

