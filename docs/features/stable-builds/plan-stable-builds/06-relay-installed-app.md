# 06 — The relay starts the installed app, never `npm start`

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

**Repo: wigley-ai-marketplace** (`D:/ai-dev/wigley-ai-marketplace`, commits straight to `main`).
**Gate:** run only once `git -C D:/ai-dev/wigley-ai-marketplace status --short plugins/wigley/scripts/forms/start_app.py`
prints nothing (a peer's uncommitted edit was there at plan time). Until then the group waits, and the run reports the
wait. Never stash, revert or commit that edit.

Files:     modify `plugins/wigley/scripts/forms/start_app.py` · test `plugins/wigley/scripts/forms/tests/test_start_app.py`
Consumes:  the install paths in `plan.md` § File Structure (group 05 writes the app there)
Produces:  `def installed_app_command(env, platform: str = sys.platform, is_file: Callable[[PurePath], bool] = lambda p: Path(p).is_file()) -> tuple[list[str], str]`
           in `start_app.py`, replacing `npm_start_command`
Decisions: start the installed stable app and drop the `npm start` fallback (Q7) · README already says so (commit
           `590de60d`, docs written ahead)

**Changes**

- `installed_app_command` returns `([str(<binary>)], str(<folder holding it>))`, the path built with
  `PureWindowsPath` on win32 and `PurePosixPath` on darwin, so the tests pass on either OS:
  - win32: `<LOCALAPPDATA>\Programs\wigley-ai-gui\wigley-ai-gui.exe` (`LOCALAPPDATA` read from `env`)
  - darwin: `/Applications/wigley-ai-gui.app/Contents/MacOS/wigley-ai-gui`
  - Binary missing: `StartFailed("there is no installed wigley-ai-gui app at <path>; run npm run install-app in the wigley-ai-gui repo")`
  - Another platform: `StartFailed("there is no installed wigley-ai-gui app on <platform>; run npm run install-app in the wigley-ai-gui repo")`
  - win32 with no `LOCALAPPDATA`: `StartFailed("LOCALAPPDATA is not set, so the installed wigley-ai-gui app cannot be found")`
- **Only the stable folder starts the installed app.** With no endpoint file, `launch_app` starts the installed app
  only when the endpoint folder is the default `ENDPOINT_DIR`; any other folder (a session pointed at
  `~/.agents/wigley-ai-gui-dev` before the dev app ever ran) fails at once with
  `StartFailed("no app has run with its endpoint in <folder>; start that app first")`, since the installed app never
  answers on another folder (cold reader, Decided). `launch_app` takes the endpoint folder to decide this. The
  recorded-command fallback to the installed app follows the same rule.
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
GIVEN win32 with no LOCALAPPDATA WHEN `installed_app_command` runs THEN it raises the pinned LOCALAPPDATA message
GIVEN an endpoint folder other than the default and no endpoint file WHEN `start_app` runs THEN it fails with the pinned message and spawns nothing

Tests:     rename the `NpmStartCommandTests` class to `InstalledAppCommandTests` and replace its tests with one per
           GIVEN above that targets `installed_app_command` (inject `is_file`); the `StartTests` and `EarlyExitTests`
           tests that pass `npm_start=` pass `installed_app=` and keep their claims, with "npm start" in their names
           reworded to "the installed app"
Done when: `(cd plugins/wigley/scripts/forms && python3 -m unittest discover)` passes, apart from failures that
           fail without this change too; `python3 scripts/check_manifests.py --against origin/main` passes
           (the marketplace `AGENTS.md` § Done)
Commit:    one commit in wigley-ai-marketplace for the group

## Proof

Commit marketplace 30ab1331 · proof: diff read: installed_app_command replaces npm_start_command as planned; default-folder rule in spawn_installed_app; worker ran forms unittest (only pre-existing AF_UNIX errors) and check_manifests (passed, rides 1.10.0) · concerns: Path equality treats a differently spelled default folder as non-default; start_app docstring's inserted sentence breaks the 'before then' reference and overruns the line width (lead)
