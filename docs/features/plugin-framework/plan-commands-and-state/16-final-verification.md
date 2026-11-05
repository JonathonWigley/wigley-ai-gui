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

Commit 0dee7e2d, fake harness. Grades come from the third run over the second, where the third run reran a check. The second run ran at bde22bdc, the third at 0dee7e2d.

**Filtered self-test.** Fourteen plugins, every group: 955 PASS, 1 FAIL, 1 SKIP.

- The FAIL is `agent-lines` `Escape zla fits the held width`: `session-row holds 156px in 134px`. The row needs 156px at the side bar's 160px least width. The same step fails on the base `7001a175` (156px in 149px), so it is old. The 134px comes from a 15px scrollbar that the fourteen plugins' rows cause.
- The SKIP is `every key placed`: a filtered run leaves out the binds of the scripts and groups it skips.
- The second run's two `forms / user keymap` FAIL lines were a stale script, not a bug: an unknown command id drops its own bind (task 07, decisions 30 and 31). The script now checks a refused bad arg and then an unknown id, and `--plugin forms` passes (232 PASS).

**Drive checks.**

| # | Result | Tag | Evidence |
|---|---|---|---|
| 1 | PASS | expected | Entry `assistant-7` held 5816 chars with `streaming:true`, then 5820 final. `.chat-streaming` was present at 1413 ms and 2418 ms and gone at 2921 ms. The fake sends one partial and one final, so growth is one step. DOM text length is no measure, because visual frames replace source. |
| 2 | PASS | expected | Two sessions and a reload: rows, selection, entries (9 and 8) and status line were identical before and after. A queued message and a `planReady` flow came back. The page log has no `chat session arrival failed`. |
| 3 | PASS | low-confidence | Reload 150 ms after `.chat-streaming` showed: 23 entries before with `assistant-8` streaming, 24 after with `assistant-8` final (5820 chars) then `result-8`, `dupIds: 0`. Reload during `fake: steps`: 32 entries before and after, `dupIds: 0`, still Working. |
| 4 | PASS | low-confidence | 3203 entries, snapshot 566,786 bytes, `stateSnapshot` 9 to 10 ms. Reload to ready: 3.99 s with 3 entries, 4.40 s and 5.22 s with 3203 (CLI polling, about 1 s resolution). No felt delay. Built by 800 sends of `fake: tool`. No timing from before this plan was at hand. |
| 5 | PASS | low-confidence | Third run, through a `FAKE_PAST_SESSIONS` resume and then a kept restart. `[chat] resuming fake past session one` gave entries `fake earlier message` and `fake earlier reply`. After `fake: hold`, `quit --keep-sessions` and `start`, the row rests. Showing it: `[chat] 3 entries read in drive-project`, in order message, reply, `The app quit during this turn`. Sending `hello`: `process started (resume true)`, then `hello`, `fake agent heard: hello`, `Turn ended`, with no second history and no duplicate. One `entries read` line. Limit: the fake's history is fixed, so the sent `fake: hold` is not in it. |
| 6 | PASS | expected | After a reload the rows, selection, usage line, workflow chip and steps, agent strip (`4 (4 running)`), `Unity 1` badge and pending row all filled at once. `[agent-lines] running in unity1: 4` before and after. agent-lines is off by default (`plugins.disabled`), so it needed the setting and a restart. Flash only partly settled: the video shows no empty rows, but one frame unstyled with data in it (dev load, CSS after first paint), and the contact sheets did not catch the reload frame. |
| 7 | FAIL, old | low-confidence | Tab and row stay gone and the slots dropped the id. After `[chat] session closed: proj7` the log still has `[workflow] 5dd705bf shows idle` and `[chat] session 5dd705bf closed (code 0)`, by id, since the row is gone. The base prints the same four lines in the same order (`[chat] session closed`, `[sessions] nothing shown`, `[workflow] ... shows idle`, `[chat] session ... closed (code 0)`). Cause: the page removes the row first (`chat-view.ts:519`, `workflow/page/start.ts:162`), main then ends the held turn and the idle fold reaches `workflow-view.ts:415`, which logs through a `nameOf` that lost the label (`workflow/page/start.ts:78`). Nothing shows to the user. In `followups.md`. |
| 8 | PASS | expected | Page side: `[page] Q ran forms.choose 1` with a round open. A bad arg gave `[config] keymap.json: "binds[0].arg": command "forms.choose" needs a number.` and `.config-problem-badge` in the title bar. Other process, third run: `window.wigley.runCommand` both ways. `sessions.nextSession` gave `[sessions] activated drive-project 2`. `keys.toggleHelp` opened `.keys-help-dialog`, and Esc gave `[page] Escape ran keys.closeHelp`. `runCommand("settings.show")` gave `[settings] shown`. An `intercept` bind `<D-y>` to `settings.show` gave `[settings] shown` and `[page] showed Settings mode`. An `intercept` bind on a page command is refused by design: `"intercept[0].command" names "keys.toggleHelp", which runs in the page; an intercept bind needs a main command.` A `binds` entry naming a main command is refused the same way. Not proved: an arg across the `runCommand` route. `runCommand("forms.choose",2)` resolved with no `[forms]` line. The arg is proved through `binds` only. In `followups.md`. |
| 9 | PASS, reason wording stale | low-confidence | Box focus: `<C-n>` logged `[forms] focused notes on finding 1`, `.cm-focused`, `activeElement` is `cm-content`. Space showed `.which-key` at x6 y513, 888 by 146, bottom 659, z 202, above the status bar (top 665.4). Which-key docks above the status bar by design (`which-key-view.ts`), so it does not follow the box, and the check's wording "the hint and which-key follow the box" is stale. It gave the same rect on the page and in the box. Esc closed which-key with the box still focused (`[keys] which-key closed`), and a second Esc gave `[forms] left the box`. Help: `[page] ? ran keys.toggleHelp`, dialog 852 by 652, closed with `keys.closeHelp`. Side finding: `<C-n>` left the box at y900.9 in a 700px window, off screen, with the pane unscrolled. In `followups.md`. |
| 10 | PASS | expected | Chat: `picker shown: Folder`, `/` ran `chat.pickerFilter`, then type and Enter, `picker shown: Profile`, Enter, `starting a session in ~/dev/unity1 with work`. Docs: `picker shown: New doc by kind`, `j l`, `Place for the rule`, cancel. Docs has no filter key, so the filter half ran on chat only. `notes.picker` has one and was not driven. |
| 11 | PASS | low-confidence | User layout `layouts/unity-pool/st` reading `core.theme` in `rowBadge`: draws 1. A theme change fired once and the badge read `Unity 1 test-dark`. Touching the file gave `layout st shown (revision 4)` and draws 2. The next change fired 2 in total, where a stale listener would give 3. No error. |
| 12 | PASS | expected | No menu dump exists, so the served config stands in: 302 commands, 0 with no label. `settings.show` is `settings`, `window.summon` is `show the app`, `keys.toggleHelp` is `help`. `src/main/keybindings.ts` builds items from `labelOf`. The menu itself stays on the wrap-up list. |
| 13 | PASS | expected | `start` reached ready. `document.documentElement.dataset.platform` is `macos`. |
| 14 | PARTIAL | low-confidence | Panes, selection and recency restored after `quit --keep-sessions` and `start`. No exception in `app.log`. The page recorder across the quit holds only `pagehide`, so "no message after the first quit task" is not proved directly: neither page nor main logs when the first quit task starts, and the `stopping` lines carry no timestamps. |
| 15 | PASS | low-confidence | `theme` to `test-dark`: slot `core.theme` read `test-dark`. To `no-such-theme`: `[config] settings.json: "theme" names "no-such-theme", which no theme has`, the slot stayed `catppuccin-mocha`, and the title-bar badge showed. |

**Task 08's load, third run.**

- With `showHints` off (setting, then `restart`): shell, rows and tabs draw. 195 of 206 anchors carry `is-hint-hidden`, and no anchor with text has width. Setting `showHints` true without a reload revealed `Space?`, `⌥I` and `⌘W`, and false hid them again. Which-key still opens. DOM and reveal are proved. The flash is unsettled: the two videos hold 6 and 4 distinct frames, none showing a reload frame. By reading, `key-anchors.ts` keeps anchors hidden until `reveal()`, and the keys part sets hints as it starts, before reveal.
- With `keys` disabled (`plugins.disabled`, then `restart`): the app starts, rows and tabs draw, `.which-key` and `.keys-help-dialog` are absent, chords still run (`[page] kn ran chat.newSession`), and `app.log` has no `Uncaught`. Hints draw, with 201 of 204 non-empty anchors showing text. This follows task 08 decision 5: the core holds a boolean that defaults to true and only the keys plugin sets it off, so with the plugin off the hints stay on.

**Also checked in the third run.**

- Tab order: a new session and a reload both gave `Docs`, `Chat*`, with Chat active. A `restart` gave the same. PASS.
- `<Leader>?` over `forms.confirm`, `chat.confirm` and `chat.image`: help scrim z 201 over the other's z 200, keys go to help, Esc gave `keys.closeHelp` and the confirm or viewer remained, `y` under help ended nothing, and which-key at z 202 painted above help. PASS.
- The rendered change by eye: Settings, Keymap ends in `Window` with one row `Show the app`, keys `^⌥⌘W`, tag `Global`. Each Forms answer row shows its own number on the right. PASS.
- After the second run's fix (0be0124e): `core.mode` read `''` until the first switch because `add` revealed the first mode without telling. `modes.ts` now tells the first mode added and `''` when none remains. Live: `sessions.sessions` at start, `settings.main` after `settings.show`, `docs.docs` after a click, `sessions.sessions` after a reload.

**Left, old on the base** (in `followups.md`): the agent-lines width above, check 7's log lines, chat drawing each tab and visual frame twice per page load (`show-layouts.ts` `setLayouts` on a first load runs sessions' `checkVisible(true)`), and `layout st shown` then `layout default shown` (`layout-loader.ts:73`, `show-layouts.ts:116`).

Concerns: settingsFileDefaults relies on configSchema's check having run; `[docs] Docs tab shown` and `[docs] session index read` no longer fire at load after the modes fix because chat's tab is added first, called harmless; `isDocsModeShown` not probed directly; each load one more stateWrite.
