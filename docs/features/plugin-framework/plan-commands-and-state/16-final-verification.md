# 16 — Final verification

Status: done
Type: Task
Wave: 14 · Depends on: 15
Plan: [plan.md](plan.md)

Files: no source file changes. A check that finds a bug goes back to the task that owns it, as `wigley:make` says. Scratch goes in the session scratchpad, and drive output stays in `.drive/`.

Consumes: every task's landed code, 01 to 15.

Produces: the report below, in this task's Proof, with each check's result and its evidence (log line, screenshot name or query output).

Decisions:

- Read `.agents/skills/drive/SKILL.md` before the first drive command, and `npm run drive -- help` for the exact commands. Every Node command runs under `source ~/.nvm/nvm.sh && nvm use && …`.
- Pass `--run <id>` on every drive command, since a peer's run may be live.
- Run under the fake harness, the drive's default. `--harness claude` is not needed: no check here depends on a real reply.
- This task lists only what `wigley:writing-tests` § What earns a live run instead admits: a thing that exists only with the running system, tagged **expected** or **low-confidence** with its reason. Whatever a task's test pins is left off.
- The whole self-test does not run unless the user asks for it in the current turn: a whole run takes half an hour or more. A filtered run skips the end-of-run placement check, and the Proof says so.

**Filtered self-test.** Run once, for these fourteen plugins:

`npm run selftest -- --plugin forms,primer,settings,chat,docs,sessions,agent-lines,agent-strip,agent-skills,usage,workflow,unity-pool,notes,backlog`

A filter naming a plugin with no script fails before any step. So first run `find src/plugins -name selftest-script.ts`, and check that it lists each of the fourteen. Drop a name it does not list, and say so in the Proof.

Leave `window`, `keys`, `agents` and `visual` out: they hold no script (task 03 gives `window` none). Drive checks 8 and 9 reach `keys`, and check 6 reaches `agents`. `visual` has no live check: tasks 10 and 14 change only its deps and an event, and their tests pin them.

Tag: **low-confidence**. The tests of these tasks run against fakes, and these scripts are the one place the real Bridge, real start order and real page load meet. A failing `expect` whose log line moved is a fix in the owning task, not a change to the expectation alone.

**Drive checks.**

| # | Check | Tag | Why it needs a live run |
|---|---|---|---|
| 1 | `chat.start`, send a message, and watch the reply stream. `query` the last entry at two moments: its text grows. `screenshot` it. | expected | Task 12: entries reach the screen through the slot, through the real Bridge. |
| 2 | With two sessions and a reply done, reload the page. Both tabs come back with entries, queue, controls and status line. `wait-log` shows no `chat session arrival failed`. | expected | Task 12's main promise, across a real page load. |
| 3 | Reload while a fake reply streams. The entry continues with no gap and no duplicate. | low-confidence | The snapshot and sequence seam under load. No test crosses a real reload with live pushes. |
| 4 | Seed a long chat (a fake transcript of a few thousand entries if a drive action offers it; else the longest fixture). Reload and time from load to page ready, against `main` before this plan if a timing is at hand. | low-confidence | The snapshot now blocks every page part's start, where `invoke('sessions')` blocked only chat's tabs. Report a delay the user could feel as a concern. No budget is pinned. |
| 5 | Restart with a restored session (`start --run <id>` on the same home). Its row rests. Show its tab: history arrives once, in order. | low-confidence | The holder is empty at restart, and replay, restore and history meet only here. |
| 6 | Reload with sessions open. The sidebar rows, selection, usage line, workflow strip, agent lines and strip, and unity-pool badge all fill at once with no flash of empty. `screenshot` each. | expected | Tasks 11 and 13 removed the race rules: what shows after a page load is on the screen. |
| 7 | Close a session whose process is still ending. Its tab stays gone, and no log names it after the close. | low-confidence | Task 12's close order; a late process event against the real page. |
| 8 | Bind a test key in the run's `keymap.json` to a command with an `arg`, and to a command in the other process. Press each. `wait-log` shows each handler run. Then bind a bad `arg`: the config problem shows in the title bar. | expected | Task 07: routing across a real Bridge and the served config. |
| 9 | Key hints still draw: open which-key and help (`key` with the chords from `src/plugins/keymap.ts`), and focus a text box. The hint and which-key follow the box. `screenshot`. | low-confidence | Task 08 moved anchors, `keysFor` and box focus into core: placement is wiring the fakes cannot see, and the filtered run skips the placement check. |
| 10 | Open each picker task 09 moved (chat's start prompt and one other). Filter, then choose. `screenshot`. | expected | Task 09: `services.picker` wiring on a real page. |
| 11 | With a user layout that calls `kit.state.read`, in the run's home, change the slot's value: the part redraws. Reload layouts: no listener stays (`wait-log`, no error after the redraw). | low-confidence | Task 10: a subscription tied to a real draw. |
| 12 | The app menu's labels read: `eval` or a log line that lists the template, whichever `npm run drive -- help` offers. | expected | Task 04: labels by label. A native menu cannot be seen offscreen; the eye check is on the user's list below. |
| 13 | The app starts on this Mac with `platform.os` read: the drive start itself, and a `query` on one OS-marked element. | expected | Task 01: the record is chosen in the composition root, which no unit test runs. |
| 14 | With rows open, quit the app and restart on the same home. Panes and recency restore. The log shows no plugin message to the page after the first quit task. | low-confidence | Task 11's rows slot and task 05's push share the quit gate in `main.ts`. No unit test reaches that gate. |
| 15 | Change `theme` in settings. A slot read of `core.theme` (`eval` with `kit.state.read`, or a log line) gives the new name. Then pick a theme that fails to resolve: it keeps the name of the theme on screen. | low-confidence | Task 06 writes it in the `renderer.ts` applier wrapper, which has no unit seam. |

Each check names its evidence in the Proof. A check a fixture cannot reach, such as check 4 with no long transcript action, is reported as not reached with its reason. Do not skip it in silence.

**For the user's wrap-up only.** Synthetic keys never reach a global shortcut, never compose a dead key and never meet IME composition, and an offscreen window shows no native dialog or menu. `wigley:make` lists these in the wrap-up, with these steps. Do not wait on them, and do not record them in a follow-up or a plan box.

1. `window.summon`: with the app in the background, press its global shortcut. The window comes to the front. (Task 03 moved it.)
2. A dead key in a box: type Option+n then n in the chat box. It composes `ñ`, and no command runs. (Task 08 moved box focus.)
3. IME composition in the chat box: compose with Japanese input. Enter ends the composition, and it does not send. (Task 08.)
4. Folder dialog: start a session through "Choose folder" in chat's start prompt. The native dialog opens, and the chosen folder lands in the row. (Task 09's `services.chooseFolder`.)
5. External link: follow an `https` link in a doc. The system browser opens it. (Task 09's `services.openExternal`, which an offscreen run cannot see.)
5. App menu: open each menu. Labels read as words, not command ids. (Task 04.)

GIVEN the filtered self-test and the drive checks have run WHEN the Proof is written THEN it holds each check's result, tag and evidence.

Tests: none added.

Done when: the filtered run passes, each drive check has a result or a stated reason, every bug found has gone back to its task and been re-checked, and the wrap-up list reaches the report.

Commit: none of its own. `wigley:make` records the Proof with the run's closing change.

## Proof

Commit 0be0124e · proof: Live check through the drive tooling, report 16-2 plus the two fixes it drove (bde22bdc, 0be0124e). Filtered self-test 955 PASS, 1 FAIL (old agent-lines width), 1 SKIP. Drive checks: 11 PASS; 3 PARTIAL (5: the fake keeps no saved session so the history arm is unreached; 9: which-key in a chat box unreached; 14: no-message-after-first-quit-task not directly proved). Check 7 FAIL is the old post-close log lines, present on base. Check 4: 3203 entries reload in 4.4-5.2s against 4.0s with 3, no felt delay. Check 6 flash only partly settled. · concerns: settingsFileDefaults relies on configSchema's check having run; [docs] Docs tab shown and [docs] session index read no longer fire at load after the modes fix because chat's tab is added first, called harmless; isDocsModeShown not probed directly; each load one more stateWrite
