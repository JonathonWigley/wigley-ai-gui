# 13 — Final verification

Status: not started
Type: Task
Wave: 9 · Depends on: 12
Plan: [plan.md](plan.md)

Files: none changed, unless a check finds a bug. A fix goes through `wigley:make`'s fix path.

Consumes: tasks 01-12 landed; `.agents/skills/drive/SKILL.md`, read whole before the first command.

Produces: a report: each check below passed or failed, with its evidence (a log line, a query result or a screenshot name).

Decisions:

- This task holds only what `wigley:writing-tests` § What earns a live run instead admits. A GIVEN/WHEN/THEN a test pins earns no live check.
- Run the drive checks in one `drive` run. Switch plugins with the drive actions `core.stopPlugin`, `core.startPlugin` and `core.restartPlugin` (args `{"id":"<id>"}`) from task 08, or through Settings' Plugins section where a check says so. Wait on the `[plugin-switch] off <id>`, `on <id>` and `restarted <id>` lines: start the `wait-log` before the `do`, or read `app.log` after it, since `wait-log` sees only lines logged after it starts. A drive run is not the self-test: `agent-lines` and `usage-tab-line` start off by default (`src/config/settings.ts`, measured at plan time, re-verify), so a check that needs one starts it first. Reload with `eval` of `location.reload()`, then `ready`, whose `load` number must rise.
- Self-test: filtered runs only, naming each plugin the plan touched that hands a script. They are `settings`, `forms`, `primer`, `docs`, `backlog` (task 07), and those of the ten plugins task 05 moved off `core.pageReady`: `agent-lines`, `agent-skills`, `agent-strip`, `chat`, `notes`, `sessions`, `unity-pool`, `usage`, and the three workflow levels `workflow-heavy`, `workflow-light`, `workflow-medium`, whose scripts cover `workflow` (it hands none, nor does `usage-tab-line`; measured at plan time, re-verify against tasks 05 and 07 and `ls src/plugins/*/main/selftest-script.ts`). The whole self-test runs only when the user asks in the current turn, since a run takes half an hour or more.
- The agent launches no browser. Drive runs the app itself through its own tooling.
- **Fallback for check 3:** a page part whose view stays empty after `core.startPlugin` is a missing `ready()` move in task 05. Fix that part through the fix path; do not add a page reload to the switch.

## Drive checks

Tag: **expected** is the change doing what it was made to do; **low-confidence** is where a bug is likely.

1. **expected** — the bridge is closed. `eval` of `window.wigley.claim()` throws `the bridge was already claimed`. `eval` of `Object.keys(window.wigley)` lists only `claim`. Reason: the claim runs across the real preload and context bridge, which no unit test loads.
2. **expected** — a leaf switches live through Settings. Open Settings' Plugins section and pick `false` on gallery. Assert `[plugin-switch] off gallery`, that gallery's mode leaves the activity bar (`query` of the activity bar), and that help lists none of gallery's commands (open help with its key through drive's `key`, then `query` its rows). Pick `true`: `[plugin-switch] on gallery`, and the mode and commands come back. Reason: the switch crosses main, the Bridge request and the served push in the running app.
3. **low-confidence** — a page and main plugin comes back without a reload. Run `core.stopPlugin` then `core.startPlugin` on `unity-pool`. Then `core.startPlugin usage-tab-line`, stop `usage-tab-line`, stop `usage`, start `usage`, start `usage-tab-line`. Assert by `query` that each one's view draws its rows again and the `ready` `load` number did not rise. Reason: `ready()` after a live start is the path that replaced `core.pageReady`, and only a real page part shows whether it re-subscribed.
4. **low-confidence** — restart keeps slots. With two session rows open and a transcript showing, run `core.restartPlugin {"id":"sessions"}`. Assert `[plugin-switch] restarted sessions`, a `[plugin-host] stopping <id>` line for sessions and each dependent, the same rows by `query`, the transcript still showing, and that a chat message sends. Reason: sessions has 16 main dependents (measured at plan time, re-verify); the dependents restart is wiring no unit test runs whole.
5. **low-confidence** — chat switched off and on joins its sessions again. Start a chat session and send a message. Switch chat off with Settings' Plugins section after switching off each plugin its lock names, or with `core.stopPlugin` in that order. Assert its rows close. Switch chat and the others on again: the session's row comes back with its transcript and takes a new message, which shows its agent process ran on. Reason: chat's dispose and re-attach run live for the first time.
6. **expected** — a refusal. Open a round with `forms.openRound`, then run `core.stopPlugin {"id":"forms"}`. Assert `[plugin-switch] refused forms: <reason>`, that the title bar badge and toast show `"plugins.disabled" names "forms", which cannot stop now: …`, and that the round is still open. Submit the round: within the 2-second retry, `[plugin-switch] off forms` logs and the badge clears, with no further edit. Reason: the refusal reaches the user through the config problem path, across processes.
7. **expected** — the lock. Start `usage-tab-line` first. In Settings' Plugins section, the usage row shows locked with "needed by" naming usage-tab-line's label. Picking `false` on it shows the `mayDisable` refusal and writes nothing. Reason: the locked row's look and its refusal are on screen.
8. **expected** — the look of the Plugins section. Take a `screenshot` of the section, of a row switched off and of the locked row. Check them by eye against `DESIGN.md` and the other Settings sections: labels, descriptions, spacing, and the picker the boolean settings use. Reason: correctness here is a judgement on screen.
9. **low-confidence** — a hand edit with open work. Open a round, then write `{"plugins":{"disabled":["forms"]}}` into the drive run's settings.json directly. Assert the config problem badge and toast, and that forms still runs (`query` the `core.plugins` slot: forms `on: true`). Reason: the hand edit takes the config watch path, not Settings' `mayDisable` ask.
10. **low-confidence** — a reload after a live switch. Switch gallery off, then reload the page. Assert gallery's page part does not start (no gallery mode by `query`) and the `core.plugins` slot still shows gallery `on: false`. Reason: the page reads the applied list from the served config on load; a stale frozen list would start it again.

## Filtered self-test

**expected** — run once per plugin listed in Decisions. Reason: each script's `expect` lines cross processes with the real page, and task 05 moved ten plugins' start-up into `ready()`. A line that fails is a bug or a stale `expect`; report which.

## For the user's wrap-up

List these in the final reply only, with their steps. They need the user's hands:

- A live quit with sessions open: start the dev app from a terminal (`npm start`), open two chat sessions, press Cmd+Q. The app closes only after the stops finish. A stop that hangs past 5 seconds prints `wigley-ai-gui quit: quit is waiting on <id>` in the terminal. Relaunch: each session's run time is kept.
- A second Cmd+Q during that wait: the app keeps waiting rather than exiting.
- Settings' Plugins section by keyboard and mouse: switch gallery off and on, and try the locked usage row.

Done when: each check above reports passed, or failed with a named fix or concern; the filtered self-tests ran; the wrap-up list is in the report.
Commit: none, unless a fix lands through the fix path.

## Proof
