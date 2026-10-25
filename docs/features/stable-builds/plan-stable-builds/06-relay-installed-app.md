# 06 — The relay starts the installed app, never `npm start`

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

**Repo: wigley-ai-marketplace** (`D:/ai-dev/wigley-ai-marketplace`, commits straight to `main`).
**Gate:** run only once `git -C D:/ai-dev/wigley-ai-marketplace status --short plugins/wigley/scripts/forms/start_app.py`
prints nothing (a peer's uncommitted edit was there at plan time). Until then the group waits, and the run reports the
wait. Never stash, revert or commit that edit.

Files:     modify `plugins/wigley/scripts/forms/start_app.py` · test `plugins/wigley/scripts/forms/tests/test_start_app.py`
Consumes:  the install paths in `plan.md` § File Structure (group 05 writes the app there)
Produces:  `def installed_app_command(env, platform: str = sys.platform, is_file: Callable[[Path], bool] = Path.is_file) -> tuple[list[str], str]`
           in `start_app.py`, replacing `npm_start_command`
Decisions: start the installed stable app and drop the `npm start` fallback (Q7) · README already says so (commit
           `590de60d`, docs written ahead)

**Changes**

- `installed_app_command` returns `([<binary>], <folder holding it>)`:
  - win32: `<LOCALAPPDATA>\Programs\wigley-ai-gui\wigley-ai-gui.exe` (`LOCALAPPDATA` read from `env`)
  - darwin: `/Applications/wigley-ai-gui.app/Contents/MacOS/wigley-ai-gui`
  - When the binary is missing, or the platform is neither, raise
    `StartFailed("there is no installed wigley-ai-gui app at <path>; run npm run install-app in the wigley-ai-gui repo")`
    (for another platform: `"... no installed wigley-ai-gui app on <platform>; ..."` with the same ending).
- Rename `npm_start` parameters and `spawn_npm_start` to `installed_app` / `spawn_installed_app` and their
  docstrings to the installed app; the fallback error text becomes
  `the recorded launch failed (<a>), and so did starting the installed app (<b>)`.
- Remove `DEFAULT_REPO`, `NVM_SCRIPT`, the `shlex` import if unused, and every mention of `WIGLEY_AI_GUI_DIR`.
- `start_app`'s docstring and the module docstring follow the README's "Starting the app".
- Version: the plugin's unpushed bump already sits above origin (`1.9.3` vs `1.9.1` at plan time); this change rides
  it. If origin has caught up by run time, bump the patch in both manifests per the marketplace `AGENTS.md`.

GIVEN no endpoint file and an installed app WHEN `start_app` runs THEN it spawns the installed binary
GIVEN a recorded command that cannot spawn WHEN `start_app` runs THEN it falls back to the installed binary
GIVEN no installed app WHEN `installed_app_command` runs THEN it raises naming the path and `npm run install-app`
GIVEN win32 with `LOCALAPPDATA=C:\L` WHEN `installed_app_command` runs THEN the command is `C:\L\Programs\wigley-ai-gui\wigley-ai-gui.exe`
GIVEN linux WHEN `installed_app_command` runs THEN it raises naming the platform

Tests:     rename the `NpmStartCommandTests` class to `InstalledAppCommandTests` and replace its tests with one per
           GIVEN above that targets `installed_app_command` (inject `is_file`); the `StartTests` and `EarlyExitTests`
           tests that pass `npm_start=` pass `installed_app=` and keep their claims, with "npm start" in their names
           reworded to "the installed app"
Done when: `python3 -m unittest discover -s plugins/wigley/scripts/forms/tests` passes, apart from failures that
           fail without this change too; `python3 scripts/check_manifests.py` passes
Commit:    one commit in wigley-ai-marketplace for the group

## Proof

