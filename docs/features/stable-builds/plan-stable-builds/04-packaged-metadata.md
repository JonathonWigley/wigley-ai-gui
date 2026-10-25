# 04 — The packaged app shows Auri in the OS

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `forge.config.mts`
Consumes:  nothing
Produces:  `packagerConfig.win32metadata` and `packagerConfig.extendInfo` in `forge.config.mts`
Decisions: "Auri" is display only; exe, bundle and paths keep `wigley-ai-gui` (Q6)

**Changes**

- `packagerConfig` gains, keeping `asar: true`:
  - `win32metadata: { ProductName: 'Auri', FileDescription: 'Auri' }`
  - `extendInfo: { CFBundleName: 'Auri', CFBundleDisplayName: 'Auri' }`
- `name` and `executableName` stay unset, so the output keeps `out/wigley-ai-gui-<platform>-<arch>/` with
  `wigley-ai-gui.exe` and `wigley-ai-gui.app`, the paths `scripts/drive.mts` (`appCommand`) and group 05 use.
- Verify both option names against the `@electron/packager` options docs for the version in `package-lock.json`
  before writing them.

Tests:     none — packaging config; group 08 packages and checks the output
Done when: `npm run typecheck` passes; `forge.config.mts` holds the two options above
Commit:    one commit for the group

## Proof

