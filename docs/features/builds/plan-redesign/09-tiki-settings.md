# 09 — Tiki Smash download paths

Status: not started
Type: Task
Rung: standard · a settings edit in the shape design.md § Configuration gives; no code
Wave: 5 · Depends on: 02 (its parser reads a kind's `downloads`)
Plan: [plan.md](plan.md)

Files:
- modify `~/.config/wigley-ai-gui/settings.json` (the user's own file, outside the repo; never committed)

Consumes:  the `downloads` field of a kind, as `parseKinds` in `src/plugins/builds/main/backend-config.ts` reads it ← 02

Produces:  a `downloads` list on each kind of the `tiki-smash` game of the `work` backend in the user's `settings.json`

Decisions:
- **Where.** `builds.backends[]` holds the backend with `id` `work` (`kind` `teamcity`); its `games[]` holds
  `tiki-smash` with the kinds `dev`, `qa` and `release`, each with only `label` and `target` today (read at plan
  time). Add `downloads` to each kind and change nothing else.
- **The values**, verbatim:
  - `dev`: `[{ "label": "Android zip", "path": "~/Library/CloudStorage/GoogleDrive-jonathon@peoplefun.com/My Drive/bash best/builds/{version}/Dev/android_BashBest_{version}.{number}_android.zip" }]`
  - `qa`: the same with `/QA/` for `/Dev/`
  - `release`: the same with `/Release/` for `/Dev/`
- **Where the values come from.** Only the Dev path was seen in a log (plan.md Preconditions, build 821433). The QA
  and Release paths are inferred from that Dev path and the Deploy Android step config in TeamCity, which writes
  `bash best/builds/%SEMANTIC_VERSION%/<Dev|QA|Release>/android_%artifactName%.zip` with only the environment folder
  changing. Keep all three. A wrong guess shows as no file button for that kind, and costs nothing else.
- **How.** Edit the file with a JSON-aware write (read, set the three keys, write back with the file's 2-space
  indent), so no other setting moves. The file holds other settings that may be secret: print none of them, and
  show only the three `downloads` values in the report.
- **No reinstall wait.** The installed app's parser (`parseKinds` on `origin/main`, read at plan time) reads only a
  kind's `label` and `target` and ignores other keys, and `builds.backends` takes any record shape. So the write is
  safe now: today's app ignores `downloads`, and the app from this branch reads it once installed.
- **The Drive folder.** Google Drive for desktop mounts only My Drive. The shared `bash best` folder shows under
  `My Drive` only after the user adds it there as a shortcut, in Google Drive on the web. At plan time the mount held
  no `bash best` folder. Until the user adds it, every file check finds nothing and the app shows no file button:
  that is no error.
- **Wrap-up line.** The run's wrap-up tells the user once, under Still open: add the shared `bash best` folder to My
  Drive as a shortcut in Google Drive on the web, so the Tiki Smash zips show in Builds mode.

GIVEN the settings file WHEN the task ends THEN each of the three Tiki Smash kinds holds exactly the `downloads` above
and every other value of the file is unchanged.

Tests:     none: this is user data, not code. The check below is the proof.

Done when: one `python3 -I -c` run (it needs no app) parses the file with `json.load`, prints only
`builds.backends[id=work].games[id=tiki-smash].kinds.<kind>.downloads` for the three kinds, and asserts, printing
nothing else: each value equals the one above byte for byte; each of the three kinds holds exactly the keys `label`,
`target` and `downloads`; and each `downloads` element holds exactly `label` and `path`, the keys `parseKinds` reads
(task 02). The parse fails on a file that is not JSON, so it also proves the file still parses.
Commit:    none: the file is outside the repo. Record the read-back in Proof.

## Proof

