# 13 — Docs, the views' self-test steps, and the doc re-read

Status: done
Type: Batch
Rung: standard · doc-only apart from the self-test groups, which follow `src/plugins/backlog/main/selftest-script.ts`
and add no interface
Wave: 4 · Depends on: 09, 12
Plan: [plan.md](plan.md)

Paths are relative to `wigley-ai-gui/`. Every entry below describes landed code. Read the code before writing each
line, and write what it does, not what this plan meant it to do. Where the two differ, the code wins, and the
difference goes in the report. Run `wigley:writing-for-agents` on each edit, since every file here is one an agent
reads.

Files:
- modify `AGENTS.md`
- modify `docs/keymap.md`
- modify `DESIGN.md`
- modify `docs/features/layouts/design.md`
- modify `docs/features/work-inbox/design.md`
- modify `docs/features/work-inbox/spike.md`
- modify `src/plugins/work/main/selftest-script.ts`
- modify `README.md` and `CHANGELOG.md`
- modify `src/plugins/work/main/selftest-fixture.ts`, only to set the `at` values the steps below need

Consumes:
- the landed `work` plugin: its manifest, its contract, its main and page parts, and its self-test fixture and script ← 09
- 09's `reseedStep(group: string): SelfTestStep` in `selftest-script.ts`, which re-seeds the fixture so a group sees
  no other group's changes; its expected line is `[work] fixture seeded: 7 items, 7 cards, 3 suggestions` ← 09
- the registered views and every bind ← 12
- 01's `Git.branches` and `Git.commitsMatching`, 02's `PullRequests` and `services.pullRequests`, and 03's
  `LaunchRequest.permissions` and `AgentStart.permissions`, as landed. Each is reached through 09 and 12.

Produces:
- the doc entries below, each in the place named
- two self-test groups, `inbox keys` and `board keys`, in `src/plugins/work/main/selftest-script.ts`

## AGENTS.md

Match the neighbouring entries' shape and voice. Each place is named by its current text, so a moved line is found
by a search.

1. **Plugin folder list** (§ Architecture, the `src/plugins/` block). Add three entries right after the `backlog/`
   entry, which ends `` `docs/features/backlog/design.md` ``, and before `practice/`:
   - `work/`: manifest.ts and contract.ts (the `work.state` slot and the work commands). Then main/, listing each
     landed module:
     - the store in plugin data
     - the job queue (the pure reducer) and the runner: one unattended session per job through chat's `launch` with
       `permissions: 'auto'` and `owner: 'work'`, closed through `close` once idle
     - the worker's MCP tools, which answer only the running job's session
     - the job text
     - detection (pure) and its signals, read from `services.git`, `services.pullRequests`, `chat.session` and
       `sessions.rows`
     - the actions and clearing, and spin-up
     - the self-test fixture and script
     Then page/ (what 04's page part does, as landed), and `docs/features/work-inbox/design.md`. Model it on the
     `auto-retro/` and `backlog/` entries.
   - `work-inbox/`: manifest.ts, contract.ts (`work-inbox.place`), and main/, which registers the layouts only. Then
     page/:
     - Inbox mode: the section nav in the side bar and the card list
     - `inbox-state.ts`, the pure view state
     - `inbox-view.ts`
     - the sample state and the demo step
     - `layout/`
     Then layouts/ (its Layout contract and `default` layout) and `docs/features/work-inbox/design.md`.
   - `work-board/`: the same shape, with Board mode's columns, `board-state.ts` and `board-view.ts`.
2. **`git/` in the `src/main/` block.** It begins `git adapter behind Git, over ProcessRunner:`. Add the two methods
   to its list, before `→ the only place the app runs git`: each local and remote-tracking branch with its tip's time
   (`branches`), and the commits on every ref whose message matches a pattern (`commitsMatching`).
3. **A new `pull-requests/` entry in the `src/main/` block, after `git/`.** It is the `gh` adapter behind
   PullRequests: each open, merged or closed pull request of a folder's GitHub repo, or null when `gh` is missing or
   not logged in, or the folder has no GitHub remote → the only place the app runs `gh`.
4. **`src/contracts/` in the folder block.** Its list starts `interfaces and records crossing a seam`. Add
   `pull-requests.ts`: the `PullRequests` service behind `services.pullRequests`.
5. **The ambient service bullet** (`- **An ambient service** —`). Add `pull requests (pullRequests, main only, through
   the gh CLI)` after `git (main only)`.
6. **The `chat/` entry's export list.** Find `` `launch` (with `unattended`: every permission prompt denied at once)
   and `close` (one owned session, with a reason) to auto-retro ``. Add after it: `launch` (with `unattended`,
   `owner` and `permissions: 'auto'`, the harness's most permissive launch) and `close` to work.
7. **The agent harness bullet** (`- **An agent harness** —`). Add one sentence: a launch's `permissions`
   (`AgentStart.permissions`, `'default'` or `'auto'`) is a role-based choice that each harness maps to its own
   mode. Claude Code maps `'auto'` to `--dangerously-skip-permissions` with mode `bypassPermissions`, set at launch
   only, since Claude refuses bypass mid-session. Name only what 03 landed.
8. **The self-test script list** in § Running and testing. Its sentence is `A key behaviour the agent adds or fixes
   gets a step in its plugin's self-test script (...)`. Add `src/plugins/work/main/selftest-script.ts for the work
   plugin, Inbox mode and Board mode` before `src/plugins/demo/main/selftest-script.ts`.
9. **`- **A key** is a default bind`** needs no change. The views add binds, not a rule.

## docs/keymap.md

1. **Leader groups table, row `k`.** Its Binds cell becomes `` `ks` Sessions, `kd` Docs, `kb` Backlog, `ki` Inbox,
   `kj` Board, `kp` Practice, `kt` Schedules, `kc` Chatroom, `k,` Settings ``. Keep the table's padded column
   widths aligned, as the file has them.
2. **The Ctrl+n paragraph** (`- **Ctrl+n** opens the new-session prompt`). Add `the Inbox sections, list and draft
   box, the Board` after `the Backlog table, review pane and chunk strip`.
3. **The Raw key paragraph's Backlog sentence** (`Backlog's own keys (...) are listed in
   docs/features/backlog/design.md § The mode.`). Add after it: `The Inbox's and the Board's own keys (` + a short
   list as landed + `) are listed in docs/features/work-inbox/design.md § Keys.` The short list is `i` draft,
   Cmd+Enter send, `d` dismiss, `z` snooze, `u` restore, `b` add to Board, `s` session, `t` ticket or threads, `W`
   sweep, `gs` the last job's row, and on the Board `H`/`L` move, `y`/`n` accept or not yet.
4. **The side-bar list paragraph** (`- **A side-bar list** opens the cursor's item on Enter`). Add `the Inbox
   sections` to its parenthesised list.
5. **The Alt+hjkl paragraph's side bar list** (`to the shown mode's side bar on the left (the Sessions list, the docs
   tree, ...`). Add `the Inbox sections`.
6. **The "Every pane that scrolls or holds rows" paragraph.** Add `the Inbox list` and `the Board, whose h/l move
   between columns`.

## Other docs

- **`DESIGN.md` § Surfaces.** Add an **Inbox** and a **Board** entry after **Backlog**, describing each `default`
  layout's look as landed, in the shape of the Backlog and Schedules entries:
  - Inbox: the side bar's section rows and their counts (the Needs you `warning` Tag), the head and status line, the
    filter chip, and the card's lines, actions and Needs you `status-warning` edge
  - Board: the columns, the card kinds, the suggestion block, the moving line and the flash
  The warning edge is drawn in layout CSS, not as a Card variant (10's Decisions), so say so.
- **`docs/features/layouts/design.md`, the owner table.** Add rows after `backlog`:
  - `work-inbox` | `work-inbox.layout` | the side bar's section rows, the main pane's head, status line, filter chip,
    cards (with the draft box slot) and empty text
  - `work-board` | `work-board.layout` | the board's head and status line, the columns, the Jira and local cards
    with their suggestion and moving lines, and the empty text
  Use the part names as landed.
- **README.md.** Both files exist on `main`, written ahead by the shareable-app docs commit, and every built-in
  plugin, MCP tool and setting must appear in README (its § Settings, § Built-in plugins and § MCP tools). Add, in
  the shape and voice of the neighbouring rows:
  - § Built-in plugins, after the `backlog` row: `work` (the data plugin: Slack and Jira work gathered by background
    worker sessions, with every card action), `work-inbox` (Inbox mode) and `work-board` (Board mode), each one line
    on what it does for the user.
  - § Settings' By plugin table, after the `backlog` row: a `work` row listing every `work.*` path as landed in
    04's manifest (the five `work.signals.*` leaves each by name), and a `work-inbox` row and a `work-board` row, each
    `<id>.layout`.
  - § MCP tools, after `set_backlog_chunks`: one row per tool in 06's `WORK_TOOLS` as landed, each ending `Answers
    only the running work job's session.`, as the Backlog rows end on their own scope.
  Leave § Status alone: it lists the shareable-app plan's unbuilt parts, and this plan adds none.
- **CHANGELOG.md.** Under `## Unreleased` › `### Added`, add one line each, saying what changes for the user (the
  file's own rule): Inbox mode, Board mode, and the `work` plugin's background sweeps with their settings. Add no
  version heading: CHANGELOG's own rule puts the `## <version>` heading and the version bump on the landing.
- Should the shareable-app plan's code have landed by then (plan.md Preconditions: `git -C <repo root> cat-file -e
  main:wigley-ai-gui/src/shared/agent-plugin.ts` exits 0), run `npm run lint:changelog` and its README coverage test
  as well, when `package.json` holds that script and the test exists. Otherwise neither exists yet, and the entries
  are checked by hand against the landed manifests.

## The views' self-test steps

Add two groups to `src/plugins/work/main/selftest-script.ts`, after the groups 09 wrote, over 09's fixture. Each
group opens with 09's `reseedStep(<group>)`, so it starts from the freshly seeded fixture whatever 09's
`inbox`, `board` and `sweep` groups changed before it. Take the fixture's item titles and card ids from
`selftest-fixture.ts` as landed. Each step's `expect` is a log line 10, 11 or 09 writes. Read each one from the landed
code, since the lines below name their shape. Follow `backlog/main/selftest-script.ts`, with a `why` on every step
that is not obvious.

The steps rest on these facts of the seeded fixture (09) and the views (10, 11):
- The self-test home is a temp home, so neither view has a saved place: each first show is the default one.
- Needs you holds one open card, `fixture-needs-you`, with ticket key `WRK-1`. All holds all seven items, newest `at`
  first. `fixture-dismissed` must be the oldest of the seven, so `G` under All reaches it. If the landed fixture does
  not make it the oldest, set its `at` in `selftest-fixture.ts` and say so in the report.
- The Board's columns run Backlog (`WRK-1`), Todo (`WRK-2`, then `fixture-task`), In Progress (`WRK-3`), In QA
  (`WRK-4`), Done (`WRK-5`) and Other (`WRK-6`), in the fixture's card order. `WRK-2` and `WRK-3` hold `suggested`
  moves, and `fixture-around` holds `WRK-3`, so `WRK-3` draws the `1 thread` chip. If the landed order differs, take
  the ids from it and keep each step's intent.

- **`inbox keys`:**
  1. `Space k i` expects `[work-inbox] shown`, with `checksFit: true`, then `section Needs you` and
     `selected <fixture-needs-you title>` (first show).
  2. `i` expects `[work-inbox] box focused`, then `Esc` expects `list focused`.
  3. `t` expects `[work-board] shown` and `[work-board] flash WRK-1`. Then `Space k i` expects `[work-inbox] shown`.
  4. `d` expects `[work] dismissed fixture-needs-you`.
  5. `Alt+h` expects `sections focused`. `G` expects `section cursor All`, and `Enter` expects `section All` and
     `list focused`.
  6. `G` expects `selected <fixture-dismissed title>`, `gg` expects `selected <newest title>`, and `j` expects
     `selected <second title>`. Then `G` again, and `u` expects `[work] restored fixture-dismissed`.
  7. `Alt+h`, then `gg` expects `section cursor Needs you`, `j` expects `section cursor You promised`, and `Enter`
     expects `section You promised` and `list focused`.
  8. `W` expects `[work] sweep queued`. Why: the bind runs `work-inbox.sweep`, which reaches main through the view's
     reporting run.
  9. `Ctrl+n` expects `[chat] picker shown: Folder`, then `Escape` expects `[chat] picker closed: Folder`, as
     `chat/main/selftest-script.ts` closes it, so the next group's keys do not land in the open picker.
- **`board keys`:**
  1. `Space k j` expects `[work-board] shown` and `selected WRK-1` (first show: the first card of the first column
     with cards).
  2. `l` expects `selected WRK-2`, and `j` expects `selected fixture-task`.
  3. `L` expects `[work] moved fixture-task to In Progress`. A local task moves at once, so the cursor stays on it, now
     in In Progress after `WRK-3`.
  4. `k` expects `selected WRK-3`. `t` expects `[work-inbox] shown` and `[work-inbox] filter WRK-3`. Then `Esc`
     expects `[work-inbox] filter cleared`.
  5. `Space k j` expects `[work-board] shown`, with the cursor back on `WRK-3` from the place. `y` expects
     `[work] moving WRK-3 to In QA`.
  6. `h` expects `selected WRK-2`, and `n` expects `[work] not yet WRK-2`.
  The fixture launches no worker: a job that queues stays in the self-test's queue, as 09's `sweep` group shows.

Should a step need a fixture record 09 did not write, add it to `selftest-fixture.ts` and say so in the report. The
whole self-test runs the end-of-run placement check, which every in-view bind must pass through 10's and 11's anchors.

## Doc re-read

Do this after the entries above, against the landed code:

- **`docs/features/work-inbox/design.md`**, line by line:
  - Drop the line `Planned in plan-work-inbox, not built yet: every plugin, command, setting and key below lands with
    that plan.`
  - Check every section, setting default, signal column, key and command name against the manifests,
    `src/plugins/keymap.ts` and the code.
  - Add the in-view keys to § Keys, in the shape of `docs/features/backlog/design.md` § The mode.
  - Add to § Inbox and § Board the landed facts a later change would reopen:
    - All as the seventh nav row
    - the ticket filter
    - the draft kept in `work-inbox.place`
    - Other shown only while it holds a card
    - Delete with no confirm
  - Fix every stale line.
- **`docs/features/work-inbox/spike.md`.** It is the spike's record, so keep its history. Where it names a key or
  setting the landed code renamed, add the landed name beside it:
  - the Tuned values table's `work-inbox.*` names, which landed as `work.*`
  - `Space k r`, which landed as `W`
  - Add to Backlog, which landed as Add to Board
  Leave every other line.

## GIVEN / WHEN / THEN

- GIVEN the landed tree WHEN a session reads `AGENTS.md`'s plugin list THEN it finds `work/`, `work-inbox/` and
  `work-board/`, each naming only files that exist.
- GIVEN `docs/keymap.md` WHEN its k row is read THEN it lists `ki` Inbox and `kj` Board, matching `keymap.ts`.
- GIVEN `design.md` WHEN read THEN no line says planned or not built.
- GIVEN the whole self-test WHEN it runs THEN the `inbox keys` and `board keys` groups pass after 09's groups, each
  from a fresh seed, and no `[keys] unplaced` line names a `work-inbox` or `work-board` scope.
- GIVEN README.md WHEN a reader looks up a work setting, plugin or tool THEN it has a row.

## Tests

- The two self-test groups above, run with `npm run selftest -- --plugin work`. The test gate runs the whole
  self-test, and with it the placement check.
- Every path a new doc line names exists. Check them in one call with `ls` over the paths, plus
  `grep -n "Planned in plan-work-inbox" docs/features/work-inbox/design.md`, which must print nothing.

## Done when

- `npm run lint` passes.
- `npm run selftest -- --plugin work` passes.
- The checks under Tests print what they should.
- README.md names `work`, `work-inbox` and `work-board`, every `work.*` setting and each view's `layout`, and every
  work MCP tool, each matching the landed manifests and `WORK_TOOLS`; CHANGELOG.md has their `### Added` lines under
  `## Unreleased`.

## Commit

One commit for the group: `work-inbox docs: AGENTS.md, keymap, DESIGN and layouts entries for the work plugins, the views' self-test steps, and the design re-read`.

## Proof

Commit ccff5cae5 · proof: diff read: AGENTS.md, keymap.md, DESIGN.md, layouts design, work-inbox design and spike, README, CHANGELOG edited; inbox keys and board keys groups in selftest-script.ts; final typecheck clean; lint: layers and styles clean, only the 5 pre-existing format files fail; log scan: 4 oxlint warnings caused by the run (unused WORK_TOOLS import in work-tools.test.ts; no-useless-spread on listener copies in signals.test, job-runner.test, chat start-prompt.test), handed to review · concerns: self-test groups not run yet (test gate): Inbox re-show focus and Board t logging shown then filter WRK-3 may fail; code-vs-plan differences in report 13-1 (snooze only on Waiting on others; Open in Slack is a button outside the actions list)
