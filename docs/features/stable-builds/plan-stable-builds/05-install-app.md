# 05 — `npm run install-app` builds a committed ref and installs it

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     create `scripts/install-app.mts` · create `scripts/install-steps.mts` · test `scripts/install-steps.test.mts`
           · modify `package.json` (script `"install-app": "node scripts/install-app.mts"`)
Consumes:  nothing (the packaged output names `wigley-ai-gui.exe` / `wigley-ai-gui.app`, which group 04 keeps)
Produces:  in `scripts/install-steps.mts`:
           `export function parseInstallArgs(argv: readonly string[]): { ref: string }`
           `export interface InstallPaths { buildDir: string; packagedDir: string; installDir: string; binary: string; shortcut: string | null }`
           `export function installPaths(platform: NodeJS.Platform, arch: string, repoRoot: string, env: NodeJS.ProcessEnv): InstallPaths`
           `export function isInstallDue(lockHash: string, storedHash: string | null): boolean`
Decisions: package a committed ref in a build-only worktree; `npm ci` there approved (Q2) · one command, fixed
           install path, Start menu shortcut on Windows (Q3) · start the app again after installing when it was
           running (design review) · Windows and macOS only

**Pinned values**

- Default ref `main`; `--ref <ref>` overrides; any other argument fails with a usage line.
- `buildDir`: `path.join(path.dirname(repoRoot), '.wigley-ai-gui-build')` (here `D:\ai-dev\.wigley-ai-gui-build`).
- `packagedDir`: `<buildDir>/out/wigley-ai-gui-<platform>-<arch>`.
- win32: `installDir` `<LOCALAPPDATA>\Programs\wigley-ai-gui`, `binary` `<installDir>\wigley-ai-gui.exe`,
  `shortcut` `<APPDATA>\Microsoft\Windows\Start Menu\Programs\Auri.lnk`.
- darwin: `installDir` `/Applications/wigley-ai-gui.app`, `binary`
  `/Applications/wigley-ai-gui.app/Contents/MacOS/wigley-ai-gui`, `shortcut` null.
- Any other platform: `installPaths` throws `install-app supports Windows and macOS, not <platform>`.
- The stored lock hash lives at `<buildDir>/node_modules/.install-app-lock-hash` (SHA-256 hex of
  `package-lock.json`), written only after `npm ci` succeeds.
- Quit wait: 15 s.

**Steps `install-app.mts` runs, in order** (each failure exits 1 naming the step and its output)

1. Resolve `<ref>` to a commit in the repo (`git rev-parse --verify <ref>^{commit}`).
2. Worktree: when `buildDir` is missing, `git worktree add --detach <buildDir> <commit>`; else
   `git -C <buildDir> checkout --detach --force <commit>`. The worktree is build-only, so a forced checkout is safe;
   `node_modules`, `out` and `.vite` are git-ignored and survive.
3. `npm ci` in `buildDir` when `isInstallDue` (or `node_modules` is missing), then write the hash.
4. `npm run package` in `buildDir` (never `npx`; on Windows spawn through the shell, as `drive.mts` does for npm).
5. Find a running stable app by its installed binary path, not by process name (a packaged drive run's
   `wigley-ai-gui.exe` from `out/` must not match): Windows through PowerShell
   `Get-Process wigley-ai-gui | Where-Object Path -eq <binary>`; macOS `pgrep -f <binary>`.
6. When it runs, ask it to quit gracefully — Windows `CloseMainWindow()` on that process (closing the window quits
   the app); macOS `osascript -e 'tell application "/Applications/wigley-ai-gui.app" to quit'` — and wait up to
   15 s. Still running: exit 1 saying the stable app did not quit, and install nothing. Never force-kill: it holds
   the user's open rounds.
7. Replace: copy `packagedDir` (Windows: the folder; macOS: `wigley-ai-gui.app` inside it, with `ditto` to keep the
   bundle's symlinks) to `<installDir>.new`, rename an existing `installDir` to `<installDir>.old`, rename `.new`
   into place, delete `.old`. A leftover `.new` or `.old` from an earlier failed run is deleted first.
8. Windows: write the shortcut through PowerShell's `WScript.Shell` COM object — target `binary`, working folder
   `installDir`, description `Auri`.
9. When step 5 found the app running, start it again detached (Windows: spawn `binary` detached with ignored stdio;
   macOS: `open /Applications/wigley-ai-gui.app`).
10. Print the commit installed and the install path.

GIVEN no arguments WHEN `parseInstallArgs` runs THEN the ref is `main`
GIVEN `--ref v2` WHEN `parseInstallArgs` runs THEN the ref is `v2`
GIVEN an unknown flag WHEN `parseInstallArgs` runs THEN it throws a usage error naming the flag
GIVEN win32, x64, repo `D:\ai-dev\wigley-ai-gui` and LOCALAPPDATA/APPDATA set WHEN `installPaths` runs THEN every path equals the pinned value
GIVEN darwin, arm64 WHEN `installPaths` runs THEN `installDir` is `/Applications/wigley-ai-gui.app` and `shortcut` null
GIVEN linux WHEN `installPaths` runs THEN it throws the pinned message
GIVEN a stored hash equal to the lock hash WHEN `isInstallDue` runs THEN false; GIVEN null or a different hash THEN true

Tests:     `scripts/install-steps.test.mts` — one test per GIVEN above, each asserting the literal path or message
           (Windows paths built with `path.win32`, macOS with `path.posix`, so the tests pass on either OS)
Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above; group 08 runs the command
Commit:    one commit for the group

## Proof

