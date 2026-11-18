# 17 — Final verification

Status: not started
Type: Task
Wave: 6 · Depends on: 16 (it walks the landed, doc-checked run)
Plan: [plan.md](plan.md)

The plan's one live verification: every runtime and visual check the tasks left out of their Done
when, run in the dev app through a drive run, plus one walk of the whole demo. A check a task's
test already pins is not run again; it is listed under Dropped with the test that pins it.

Files: none. The agent edits no code here; it fills `## Proof` and commits it.

Consumes:
- every landed task, 01–16
- the drive skill, `wigley-ai-gui/.agents/skills/drive/SKILL.md` (read it through before the first
  command)

## How to run

- Every check runs in one drive run of the dev app with the fake harness (the default):
  `npm run drive -- start`, from `wigley-ai-gui/`. Pass `--run <id>` on every command when
  another run may be live. End with `npm run drive -- quit`.
- Keys go through `npm run drive -- key`, in the self-test's notation: `key Space d d`,
  `key Space d n`, `key '<A-l>'`. Each check reads its result from the log lines the command returns,
  `wait-log`, `query` and a `screenshot` read back with the Read tool.
- Leader binds under test (07): `Space d d` panel, `Space d n` next, `Space d p` previous,
  `Space d a` autoplay, `Space d r` reset, `Space d h` show real sessions, `Space d x` stop. Panel
  keys: `j`, `k`, Enter, `i`.
- A file check compares a `shasum` of the file taken before the demo starts with one taken after
  `Space d x`; the run home is `.drive/<run-id>/home/` (find each file under it with `find`).
- **Reading a state slot.** The drive has no slot reader. Read a slot through agent-commands'
  `read_state` tool, called as the seeded session `S` (the `sessionId` that walk step 1's
  `chat.start` returns): `npm run drive -- do agent-commands.call '{"sessionId":"<S>","tool":"read_state","args":{"slot":"<slot id>"}}'`
  returns `{ callId }`; `npm run drive -- do agent-commands.result '{"callId":"<callId>"}'` returns
  the result, or `{ pending: true }` until it settles. `src/plugins/agent-commands/main/drive-actions.ts`
  builds the tool session for any session id it is given.
- **Running a command as an agent.** The same `agent-commands.call` with
  `"tool":"run_command","args":{"command":"<command id>","arg":"<arg>"}`. The checks use it
  for `demo.goTo <step id>`, which has no key.
- **Plugins stay as the run home has them.** No check changes `plugins.disabled`. The drive skill's
  route for a Docs-tab check (`setting plugins.disabled …`, then `restart`) is not used here:
  checks 5, 28 and 41 prove that the run itself starts the off-by-default plugins in memory
  (`runDisabledForNow`), and that route would make them pass without it.
- Tags: `expected` — the check confirms wiring the tests already shape, and is expected to pass;
  `low-confidence` — the behaviour rests on timing, focus or a path no test reaches, and the
  reason says which.
- A failing check is recorded in Proof with its screenshot path and log lines, and names the task
  that owns the behaviour. The agent fixes nothing here.
- Checks only the user's hands or eyes can settle are listed under User-only and not run.

## Whole-run walk

Run this first; it covers the run lifecycle and the real-state guarantees.

1. `start`. Seed one real session: `do chat.start '{}'` (record its `sessionId` as `S`), press `i`,
   type `Map the session list.`, press Enter, and wait for its turn to end. Close nothing.
2. Take `shasum` of: the run home's `settings.json`; `recent-folders.json` in chat's plugin data
   folder; `ui-state.json`. Read chat's `open-sessions.json` and record its rows. A `shasum` does
   not fit that file: task 03 saves `selectedHostSessionId: null` while a demo row is selected, and
   each row carries `activeMs` and `busy`, which change while the app runs.
3. `key Space d d`. The run starts (`[demo] run started`), the Demo panel opens.
4. `key Space d n` until the log reads `[demo] at the last beat`. Each press logs
   `showing <id> beat <n> of <count>: <name>`; record every `step <id> failed: …` line. The press
   that leaves the last `live`-section beat enters `demo.realSession` (only autoplay stops before
   it, 07), which under the fake harness launches a fake session in the scratch folder.
5. `key Space d h`: the real sessions show, the seeded session among them (`real sessions shown`).
6. `key Space d x`: `[demo] run stopped`.
7. Take the three `shasum`s again. `settings.json` and `recent-folders.json` match step 2.
   `ui-state.json` may differ: its `recency`, `projectRecency` and `panes` entries hold no demo
   session id and no scratch-folder path (read the file; the page may have saved other keys).
   Read `open-sessions.json` again: no row names a demo session id or the scratch folder, the same
   row ids are there as in step 2, and each row's fields other than `activeMs` and `busy` equal
   step 2's.
8. The side bar shows the seeded session and no demo row. `key Space b n` (`<Leader>bn` →
   `chat.newSession`, `src/plugins/keymap.ts:323`) opens the start prompt: it lists the run's
   projects and recent folders again, with no `~/dev/sample-app` rows. Esc closes it.

Pass: no `failed` step, every file as above.

## Checks

### Run, panel and keys (01, 05, 06, 07)

1. `expected` — `Space d d`: the Demo panel is the right bar's first stop with its sections and
   steps; the caption is centred in the status bar; the side bar shows only the Demo section's
   header and rows. Reason: wiring of tested parts (driver, view and order tests).
2. `expected` — `Space d n` and `Space d p` move beat by beat and across steps on screen; the beat
   list under the current step follows; the side bar cursor stays inside the Demo rows. Reason:
   driver tests shape it; only the drawing is unrun.
3. `expected` — `Space d h` shows the real sessions with the Demo section among them; a second
   `Space d h` hides them again. Reason: `showReal_Twice_DisposesThenRetakesTheHold` shapes it.
4. `expected` — `Space d x` removes the panel, caption and Demo section, and restores the side bar.
   Reason: stop is unit-tested per piece; the whole teardown is only seen live.
5. `expected` — an off-by-default built-in starts for the run: during `agent-lines.lines` the
   working line draws (`query ".session-row-part[data-part='agent-lines.workingLine']"` finds it)
   and agent-lines' keys work; after `Space d x` the plugin is off again (`read_state` of slot
   `core.plugins` shows agent-lines disabled, and the `query` finds no working line) and the
   `shasum` of `settings.json` is unchanged. `plugins.disabled` is never changed for this check.
   Reason: the switch logic is unit-tested, but the forwarder in `main.ts` and the page start over
   `bridge:plugin-parts` are reached only live.
6. `low-confidence` — `<A-l>` from the main view reaches the Demo panel as the right bar's first
   stop; `j`/`k` move the cursor (`cursor on <id>`) and Enter enters the step. Reason: focus order
   with the panel's order -10 stop is untested.
7. `low-confidence` — the step-agent pane, host-owned (05): on the first `Space d d` the toggle
   gives the pane the keys before any answer; `i` moves the keys into its ask box; a send mounts
   the chat view; the pane keeps the keys after the send and after the answer lands; Esc returns
   to the panel; the right bar's drag resizes it. Reason: async scope changes meet DOM focus, and
   the unit tests fake `activeElement`.
8. `low-confidence` — the step agent launches (fake harness) in the dev app's clone folder with the
   step's instructions, and a `run_command demo.goTo <id>` as the step agent moves the demo. The
   fake harness calls no tool, so the drive call stands in for the agent's: read slot
   `chat.session` with `read_state` before and after the first ask; the key the ask added is the
   step agent's session id `A`. Then `do agent-commands.call` with `"sessionId":"<A>"`,
   `"tool":"run_command"` and `"args":{"command":"demo.goTo","arg":"settings.mode"}`, and
   `do agent-commands.result` until it settles: the result reports the run, the log reads
   `went to settings.mode`, and `read_state` of `demo.run` names `settings.mode` as its step.
   Reason: an owner session's `run_command` route has no test.
9. `low-confidence` — closing a demo session from its row selects another demo row, never a
   hidden real row. Reason: crosses the page's `claimed` slot and main's `removeRow` timing.
10. `low-confidence` — a page reload mid-run (`eval location.reload()`) stops the run main still
    holds: after the reload no demo harness, demo session or plugin hold is left, and agent-lines
    is off again. Reason: reload ordering between page load and main's held run is untested.

### Shell (09)

11. `expected` — `keys.hints`: the Which-key beat shows the leader's panel, Help opens the
    overlay, Leader search opens the picker with its filter not focused, and `Space d n` still
    moves on from each beat. Reason: page wiring with no test.
12. `low-confidence` — on the Which-key beat, pressing `Space` once: the demo's which-key panel
    may vanish when the controller ends its own sequence. Reason: the controller and the step share
    one `WhichKeyView`, untested.
13. `expected` — `gallery.mode`: the Transparency beat switches the override and the swap beat
    moves the shell to the test layout. Reason: the restore is tested; the beats' drawing is not.
14. `expected` — `settings.mode`: the beats open Every setting, Plugins, Keybindings and Leader
    menu; leaving reopens the section and row the user had. Reason: `openSectionById` is tested,
    the place restore is not.

### Bars (10)

15. `expected` — `unity-pool.pool`: the demo row shows `Unity 1`, and the right bar shows the
    `demo-pool` panel through the three stages; Hold, Release and Open on it show
    `A demo clone: nothing runs.`. Reason: the slot overlay and guard are tested; the panel draw is
    not.
16. `expected` — `system-stats.panel`, with the panel hidden before the run: the step shows the
    busy sample, and leaving hides the panel again; after `restart` the panel is still hidden.
    Reason: main's overlay is tested; the page's `showForNow` is not.
17. `low-confidence` — `app-update.button` in the dev app: the title-bar button shows only during
    the step through its three beats, and a click shows Installing. Reason: the title-bar
    contribution has never drawn in the dev app (no build).
18. `low-confidence` — `auto-retro.section`: the Retro section shows under the demo's hold, with
    the demo row and `2 queued`; leaving the step shows the Demo section again. Reason: rests on
    04's stack rule and claim resolution live.
19. `low-confidence` — leaving `auto-retro.section` (06 closes its session) logs
    `ignored demo session <id>` or queues nothing, and auto-retro's `queue.json` is unchanged.
    Reason: the guard reads the row from `sessions.rows` when chat fires `sessionClosed`; the test
    sets the row by hand.

### Sessions (11, 12)

20. `expected` — every step of the `sessions` section shows its beats and caption: cards, panes,
    transcript, message box, controls (the model picker opens on the demo session and closes at
    leave), start prompt, headless, agent strip, subagents, agent lines, visuals, auto compact,
    Recently closed (the three sample rows under `~/dev/sample-app`), Stash, Skills, Context,
    Usage, Usage in the tab bar. Reason: plain wiring of existing surfaces.
21. `low-confidence` — `sessions.cards` `error` beat: the `error` card shows its word. Reason:
    depends on how the row reads a fake process end through `processEvents(id).ended`.
22. `expected` — `sessions.panes`: side by side, then stacked; leaving closes the split panes.
    Reason: calls the split picker's own path; untested as a step.
23. `low-confidence` — `chat.composer` `slash commands` beat: the `/` completion opens. Reason:
    completion opens only on an `input.type` transaction, and focus timing before `typeInto` is
    unproven.
24. `low-confidence` — `auto-compact.compact` `compacting` beat shows a held compaction. Reason:
    the order of the send gate and the usage fold is unproven live; it also needs `minTokens` under
    200000 (the drive run's default settings).
25. `low-confidence` — agents writes no log line for demo rows: after the `agents.roster` and
    `agent-strip.strip` steps, agents' log files in its plugin data hold no demo session id.
    Reason: the skip needs the sessions row to exist before the first agent event.
26. `expected` — `session-stash.stash` `note` beat opens the note dialog for the demo session;
    the `stashed in the prompt` beat lists the two sample stashed rows. Reason: wiring.
27. `expected` — `usage.meters`: the status bar shows the fixture's plans `work` and `personal`;
    the details open on the `details` beat and return to the user's state on leave; the real
    snapshot returns after the step. Reason: the sample over the real snapshot is tested; the page
    is not.
28. `expected` — `usage-tab-line.line`: the usage line shows in the tab bar during the step and is
    gone after `Space d x`, with `plugins.disabled` left as the run home has it. Reason: the run's
    in-memory start of an off-by-default plugin, live.

### Live (12)

29. `expected` — `live-view.stream` in the drive run: the hub section shows either a stream or the
    Screen Recording blocked line with its button, never an empty section; leaving the step hides
    it. Reason: the pick is tested; the drive app's grant state decides which shows.

### Forms (13)

30. `expected` — `forms.round`: the five beats show the question, finding, notice, review and
    cancel confirm on the demo row's form. Reason: rail positions rest on sample counts a test
    pins; the drawing is live.
31. `low-confidence` — `primer.primer` `A need` beat shows task 2 with `unclear` set. Reason:
    `selectTask` 1 and `needUnclear` were read from the commands, not run.
32. `low-confidence` — `audio-picker.picker` `Broken file` beat shows the broken-candidate state
    for `broken.wav`, and the candidates' sources are under `<scratch>/audio-picker/sample-sounds/`
    (`query` the audio source). Reason: the picker's error draw for a broken file in a scratch
    folder was not traced end to end.
33. `expected` — after the forms steps, primer's and audio-picker's plugin data folders are
    unchanged (`shasum` of a listing before and after). Reason: memory stores only.
34. `expected` — `agent-commands.confirm`: the forms confirm shows `Run <label>?` with the
    `closeSession` detail on the demo row. Reason: the request comes from `confirmRequest` itself.
35. `low-confidence` — `notes.note`: the popup shows the sample at target, body, images and
    session; the image strip draws the sample image; the session chip names the demo row; the
    user's draft and place come back after the step. Reason: the image bytes through the routed
    channel and the chip's `hostSessionId` are untested.

### Workflows (14)

36. `low-confidence` — `workflow.engine`: `No level` shows the `No workflow` tag on the demo row;
    `Headless` shows the headless tag; leaving clears both. Reason: whether the chip draws the tag
    while `turnRunning` is true with no turn in chat was not traced.
37. `expected` — `workflow-small.run`, `workflow-medium.run`, `workflow-spike.run`: each beat
    moves the stage strip and side pane through its stages with the checklist ticking. Reason: whole
    sample flows through `showSample`, tested.
38. `low-confidence` — `workflow-large.run`: all 13 beats draw; `Countdown` counts down for
    `autoStartSeconds` and starts nothing. Reason: the strip's plan link names a plan folder that
    does not exist in scratch, and its draw was not traced.

### Modes (15)

39. `expected` — each of the six `modes` steps shows its mode or tab with sample data and its
    caption. Reason: wiring over tested sample serving.
40. `low-confidence` — `docs.mode`: the sample split replaces the doc and the side bar hides;
    leaving puts the machine view back with the last open doc. Reason: page surgery in
    `docs/page/start.ts` with no test over it.
41. `low-confidence` — `docs.sessionTab`: docs-session-tab is off by default in a drive run and
    stays off in `settings.json` (do not enable it; How to run › Plugins stay as the run home has
    them). It still shows its tab for the run, because the run starts it in memory. The demo
    session's Docs tab lists the sample docs, and the log shows no index script run for it. After
    `Space d x` no session shows a Docs tab. Reason: wiring across docs main, the in-memory start and the demo
    harness.
42. `low-confidence` — `backlog.mode`: the table lists `backlog-repo`'s five follow-ups with
    `Moved item` marked moved; after `Space d x` Backlog reads the run's own repos again. Reason:
    the reload message on release is untested on the page.
43. `low-confidence` — `practice.mode` `run` beat: the judge result shows for Two Sum; after
    `Space d x` the Practice list is the run's own. Reason: a real compile with the setting's
    compiler, and the watch move on release.
44. `expected` — `scheduling.schedules`: three demo tasks in Schedules mode, the sweep's history
    rows, and the run row opening in Sessions mode; after `Space d x` the list holds no demo task.
    Reason: main is tested; the page wait and beats are not.
45. `low-confidence` — `chatroom.room`: the row badge on the lead row, the room board, the
    `plan-demo` thread; after `Space d x` Chatroom mode holds no room for the scratch folder.
    Reason: the release path's slot delete has no test of its draw.

### Run controls (07)

Run these after checks 1–45, in one run.

46. `low-confidence` — autoplay on screen. `demo.goTo practice.mode` (How to run › Running a
    command as an agent), then `key Space d a`: the log reads `autoplay on`. The `showing
    practice.mode beat 2 of 3` line comes 5 s or more after beat 1's, and the next step's first
    `showing` line comes 8 s or more after `beat 3 of 3: run` (dwell = max of the 5 s setting and
    the beat's `dwellSeconds: 8`); time each gap with `date +%s` around the `wait-log` calls. Then
    `demo.goTo` the step listed just before `demo.realSession` in the panel: `wait-log`, with a
    timeout past that step's beat count × 5 s, reads `autoplay stopped before demo.realSession`,
    no `entered demo.realSession` line follows, and `read_state` of `demo.run` still names that
    step. Reason: real timers on screen; the driver tests use fake timers.
47. `expected` — `Space d r` and `demo.goTo`. On `backlog.mode` beat 3, `key Space d r`: the log
    reads `reset backlog.mode`, then `entered backlog.mode` and `showing backlog.mode beat 1 of 3`,
    with no `failed` line. A `demo.goTo chatroom.room` logs `went to chatroom.room` and the panel's
    current step moves to it. Reason: the driver tests shape both; the keys and the main re-enter
    are only seen live.
48. `low-confidence` — a second run in the same app. After `Space d x`, `key Space d d` again:
    `[demo] run started`. `demo.goTo` `docs.mode`, `backlog.mode`, `practice.mode` and
    `chatroom.room` in turn: each shows its sample as on the first run (the Docs tree; the backlog
    table with `backlog-repo`'s five follow-ups; Two Sum; the `plan-demo` posts), and no
    `step <id> failed` line is logged. `find` under the run home's demo plugin data finds at
    least one folder under `scratch/old-backlog/` (an earlier run's emptied repo moved aside, task
    15). Then `Space d x`.
    Reason: catches a leaked hold or harness from the first run, and a fixture that sees the
    first run's emptied folders.

## User-only

Named in the wrap-up's `Not checked:` line; not run here.

- A real Screen Recording grant: `live-view.stream` streams the Unity editor while it runs (window
  title match), else the app's own window (`process.pid` of main), and the stream stops when the
  step is left.
- A real Claude login: `demo.realSession` under the user's own harness starts a real session in
  the scratch folder, shown in the Demo section; leaving the step closes it; after a restart no
  `open-sessions.json` row or recent folder names it.
- A real Claude login: the step agent answers a question about the current step and moves the demo
  with `run_command`.

## Dropped

Each is pinned by a test, so the run does not repeat it.

- No unity-pool CLI runs for the demo pool — `demoStep_RunOnTheDemoPool_RunsNoCli` (10).
- An app-update click during the step starts no program — `demoStep_InstallStartsNothing_AndLeavingShowsTheRealStatus` (10).
- Leaving the gallery step restores transparency and the user's swap — `demo stage dispose restores what the stage changed: $name` (09).
- The start prompt hides projects and recent folders while the demo runs — `hides projects and recent folders while the demo harness is registered` (11).
- A sample resume row resumes nothing and toasts — `a sample section row resumes nothing` (11).
- Recently closed and Stashed answer samples while the demo runs — `the section answers samples while the demo runs` and `rows answers samples while the demo runs` (12).
- No demo session in Recently closed or the stash after a run — 03's session-log `it.each` beside `chatEvents_EachEvent_WritesItsLine` and session-stash ephemeral row (03).
- The start prompt, usage and scheduling never offer profile `demo` — `usageMainPart_UnlistedHarness_NeitherPolledNorListed` and the start-prompt and scheduling `editorChoices` rows (02).
- A sample round saves no round and wakes no chat — `entering forms.round asks the sample service and saves no round` (13).
- Allow or Deny on the sample confirm runs nothing — `answer $answer runs nothing` (13).
- A sample note sends nothing and writes no follow-up — `$call is refused or inert` (13).
- Demo sessions write no `flows.json` — `$entry_$condition_$result` (14).
- Demo tasks never reach the task file or planner — `never plans, saves or fires a demo task` (15).
- The demo chatroom writes no room file — `keeps the demo room in memory` (15).
- Demo rows never stamp recency or save a pane — `recency_DemoRows_AreNeverStamped: $case` and the `savedPaneSessions: $name` demo row (11); the walk's step 7 still reads `ui-state.json` once.

## Done when

The whole-run walk and every check above have a result in Proof: pass, or fail with the
screenshot path, the log lines and the owning task. User-only checks are listed, not run.

Commit: the filled Proof, as one commit.

## Proof
