# 08 — Final verification

Status: not started
Type: Task
Wave: 3 · Depends on: 07
Plan: [plan.md](plan.md)

Runs on Windows (this machine). Every check below the agent runs itself; the user-only checks go in the wrap-up.

**Live checks**

1. **`npm run install-app` installs from `main`** — expected path. Run it from the repo. Pass: the build worktree
   `D:\ai-dev\.wigley-ai-gui-build` exists, `npm ci` ran there once, `%LOCALAPPDATA%\Programs\wigley-ai-gui\wigley-ai-gui.exe`
   exists, and `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Auri.lnk` targets it. The approval for the
   worktree's `npm ci` is the user's Q2 answer.
2. **The packaged exe shows Auri** — low confidence (group 04's metadata has no test). Read the exe's version info
   (PowerShell `(Get-Item <exe>).VersionInfo.ProductName` and `.FileDescription`). Pass: both `Auri`.
3. **The installed app takes the stable instance** — low confidence (the user data and lock split have no test).
   Start the installed exe and confirm with `Get-Process` that it stays up. Pass: it writes
   `~/.agents/wigley-ai-gui/endpoint.json` whose `launch.command` is the installed exe, and its user data folder is
   `%APPDATA%\wigley-ai-gui`. (Running it beside the user's own `npm start` is the user's check, below.)
4. **A dev drive run uses the dev instance** — low confidence (the drive harness's endpoint name changed). Run a
   dev drive start (`.agents/skills/drive/SKILL.md`). Pass: the run home holds `.agents/wigley-ai-gui-dev/endpoint.json`,
   and the stable app from step 3 is still running (the run took no lock from it).
5. **A packaged drive run still starts** — low confidence (packaging config changed). `npm run package` rewrites the
   repo's `.vite/build`, which a running `npm start` reads, and `.drive/start.lock` does not cover it: first confirm
   no `npm start` or dev drive run from this repo is running (no `electron.exe` whose command line holds the repo
   path); if one is, skip this check and report it skipped. Then `npm run package` and a drive start with
   `--packaged`. Pass: it reports ready.
6. **An agent round reaches the stable app** — expected path. With only the installed app running, send a small
   `ask_round` from a session. Pass: the round opens in the installed app (the relay found `~/.agents/wigley-ai-gui`).
7. **install-app replaces a running app** — low confidence (the quit-and-replace path). Run `npm run install-app`
   again with the installed app running. Pass: the app quits, the folder is replaced, the app starts again, and
   `~/.agents/wigley-ai-gui/endpoint.json`'s `launch.command` is still the installed exe (not `npm start`).
8. **The self-test still passes** — `npm run selftest`. Pass: `[selftest] all passed`.

**For the user, in the wrap-up only** (eyes and hands)

- With the installed Auri open, run `npm start`: both windows open; the dev window's taskbar entry reads
  "Auri Dev" and its title bar shows the Dev tag; the installed one reads "Auri" with no tag.
- The global summon shortcut brings up the installed app, and does nothing extra while the dev app runs.
- On the Mac: `npm run install-app` there, then the same two checks; the Dock shows Auri for the installed app.

Done when: checks 1–8 pass, or each failure is reported with its output
Commit:    none (verification only); `wigley:make` records the results in the Run log

## Proof

