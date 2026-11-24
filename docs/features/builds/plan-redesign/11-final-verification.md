# 11 — Final verification

Status: done
Type: Task
Wave: 6 · Depends on: 10 (it checks the landed code after the doc re-read; every code task is behind 10)
Plan: [plan.md](plan.md)

All paths are from the repo root. `wigley:make` walks this task in its live session after the test gate.

Files:     none (a drive run writes only its own `.drive/<run id>/` folder, which is git-ignored)
Consumes:  the landed 01–08; the `fixture` backend kind in a drive run, and its `saveLog` (08); the demo's
           `builds.mode` and `builds.session` steps (08); the classes `builds-file-button` (with `data-entry`) and
           `builds-open-in-builds` (07); for check 11 only, the user's own `work` TeamCity backend through
           `--user-config` and the `teamcity` CLI, read-only
Produces:  each check's result with its screenshot path, in this task's Proof section

Decisions:
- Checks 1–10 run through one drive run (`.agents/skills/drive/SKILL.md` § Loop): `npm run drive -- start --run
  builds-fixture`, then the steps below, each command with `--run builds-fixture`, then `npm run drive -- quit --run
  builds-fixture`. Check 11 runs in a second run of its own (below). Read each screenshot with the Read tool against
  `DESIGN.md` § Surfaces (the Builds bullet as task 10 left it), § Keys and focus and § Space, size and shape.
- **Window width.** Right after `start`, `npm run drive -- resize 1400 900`: the split stacks below 640 px of its own
  width (`min + endMin`, `src/shared/page/ui/split.ts`), and the default 900 px window with the side bar open leaves
  the split near that, so the side-by-side checks (1, 3, 5) need the wider window. Check 4 resizes to 600 and back to
  1400 900.
- **Fixture data.** After `start`, write `<run home>/fixture-drive/game-a-1.zip` (any text) with the Write tool, the
  run home being the `home` folder `start` prints. Then `npm run drive -- setting builds.backends '<json>'` with one
  backend: `{ "id": "fixture", "kind": "fixture", "label": "Fixture", "config": {}, "games": [{ "id": "game-a",
  "label": "Game A", "defaultBranch": "main", "kinds": { "dev": { "label": "Dev", "target": "dev", "downloads": [{
  "label": "Android zip", "path": "~/fixture-drive/game-a-{number}.zip" }, { "label": "Symbols", "path":
  "~/fixture-drive/game-a-{number}.zip" }] } } }] }`. The two downloads point at one file, so `game-a-1` has two
  files, entries 0 and 1, and `s` opens the picker. `setting` returns the lines it caused: it must hold
  `[builds] backends applied: fixture 1 games`; else `wait-log '[builds] backends applied: fixture 1 games'`. Show
  Builds mode with `key Space k m`.
- **Waiting on the page.** The page logs nothing per poll, and a foreground `sleep` is blocked, so every wait on a
  poll is a DOM wait through `eval`, which returns its last expression's value and awaits a promise. Define the helper
  once per page load (a `var` reaches the page's globals; a reload clears it, so check 2 and check 10 define it
  again):
  `npm run drive -- eval 'var waitUntil = (test, ms) => new Promise((resolve) => { const end = Date.now() + ms; const
  tick = () => { const value = test(); if (value || Date.now() > end) { resolve(Boolean(value)); } else {
  setTimeout(tick, 250); } }; tick(); })'`.
  Each wait is then `eval 'waitUntil(() => <test>, 20000)'`, which returns `true` once the test holds and `false`
  after 20 s (under the CLI's 30 s command wait); a `false` is repeated once, and a second `false` fails the check.
- **The fixture's final states.** The fixture's `game-a-2` moves one step per list (10 s while the mode shows). Before
  the graph checks, select `game-a` and put the list cursor on `game-a-2`, then wait until its jobs hold their final
  states: `eval 'waitUntil(() => document.querySelector(".builds-job-box[data-job-id=\"deploy\"]")?.textContent.includes("Cancelled"), 20000)'`.
- **Reload.** A page reload is `npm run drive -- eval 'location.reload()'`, then `npm run drive -- ready` until it
  returns a `load` one higher than before.
- A check the self-test already pins is dropped (Dropped, below).
- Run no `npm run selftest` here: the test gate has run it.

Checks:

1. **Detail pane and graph** — expected. Select `game-a` (`key j`, `key Enter` on the side bar), give the keys to the
   graph (`key <A-l>`, `key <A-l>`), and screenshot. The list sits at the start, the detail pane at the end. The
   header shows `Game A Dev #2`, the branch, the state Tag `Failed`, `Fixture ↗`. The graph shows `Build Android` and
   `iOS build` in column 0 and `Deploy` in column 1, an arrow from each of the two to `Deploy`, `iOS build` with the
   focus ring and `list-active-background`. The panel under the graph shows `iOS build`, `Failed`, `ran 15s`,
   `Archive failed`, `Log ↓` with its `s` hint and `Fixture ↗` with its `o` hint.
2. **Arrows drawn while the mode was hidden** — low-confidence: the arrows are measured from laid-out boxes (07), and
   a graph drawn while the mode is hidden measures nothing until the `ResizeObserver` fires. A same-build poll does not
   redraw a finished build's graph (07: an equal input keeps the drawn graph), so the hidden draw comes from a page
   start: show Sessions mode (`key Space k s`), reload (Decisions), and define `waitUntil` again. The Builds page
   starts hidden and draws the restored `game-a-2` graph: `query .builds-detail-pane` shows a zero-size box, or the
   check is noted as not reached (the reload showed Builds mode). Then `key Space k m`, screenshot, and
   `query '.builds-graph-arrows path'`: two paths, each joining its two boxes in the screenshot.
3. **Sideways scroll** — low-confidence: no test sees overflow. With the keys in the graph, drag the split handle
   (`drag`) to leave the detail pane about 380 px wide, then `query .builds-graph` for its `scrollWidth` and
   `clientWidth`: the graph scrolls (`scrollWidth > clientWidth`), and each box keeps its width
   (`query .builds-job-box` before and after: equal `width`). `key l` to `Deploy` scrolls it into view: screenshot.
   Wait one poll (`eval 'waitUntil(() => false, 11000)'`, which returns `false` after one poll's 10 s by design) and
   `query .builds-graph` again: `scrollLeft` unchanged by the poll. Drag the handle back.
4. **Narrow window** — low-confidence: the stacking comes from the split's own CSS, never seen with this page.
   `resize 600 800` and screenshot: the list above the detail pane, no handle, nothing clipped sideways but the
   graph's own scroll. `key <A-j>` from the list moves the keys to the graph and `key <A-k>` back (the lines
   `[builds] focus graph` and `[builds] focus list` in each command's output). `resize 1400 900`.
5. **Keys** — expected. In the graph: `key k`, `key l`, `key h`, `key j` log `job cursor on build-android`, `deploy`,
   `build-android`, `ios`, the ring moving with each (screenshot after `l`); `key Escape` gives the keys to the list.
   In the list, `key j`/`key k` move the cursor and the detail pane follows at once (`query '.builds-detail-body'`
   names the cursor's build). `key Enter` on a build gives the keys to the graph.
6. **Log save** — expected. On `iOS build`, `key s`. Wait for `[builds] download fixture/game-a-2/log/ios saved
   Game-A-Dev-2-iOS-build.log` (in the command's output, else `wait-log` with that whole line). The panel shows the
   `Saved` Tag and `Game-A-Dev-2-iOS-build.log` (screenshot); the fixture's save writes one small file at once, so
   `Saving…` is never on screen long enough to capture and is not checked. The log holds the core's reveal line (01:
   a drive run logs the reveal and opens nothing). Read `<run home>/Downloads/Game-A-Dev-2-iOS-build.log`: it reads
   `fixture log of game-a-2 ios`. `key s` again: the new file is `Game-A-Dev-2-iOS-build (2).log`.
7. **File download through the picker** — low-confidence: the two-file path runs no self-test step. `key Escape`,
   put the list cursor on `game-a-1` (`key j` until the output reads `[builds] list cursor on fixture/game-a-1`),
   `key s`: the picker opens titled `Download a file` with `Android zip` and `Symbols` (screenshot); `key Enter` on
   the first. The output holds `[builds] download fixture/game-a-1/file/0 saved game-a-1.zip`; the header's
   `Android zip ↓` button shows `Saved` and `game-a-1.zip`; `<run home>/Downloads/game-a-1.zip` exists. Then
   `click '.builds-file-button[data-entry="1"]'` (`Symbols ↓`) with the file already in Downloads: the output holds
   `[builds] download fixture/game-a-1/file/1 saved game-a-1 (2).zip`.
8. **A file that goes away** — low-confidence: no test polls a file away and back. With `game-a-1` shown, delete
   `<run home>/fixture-drive/game-a-1.zip` (`rm` of that one absolute path in the run home), then
   `eval 'waitUntil(() => document.querySelectorAll(".builds-file-button").length === 0, 20000)'`: `true`, the file
   buttons gone, since main checks each found file again on every poll (plan.md Pinned values). Write the file again
   with the Write tool; `eval 'waitUntil(() => document.querySelectorAll(".builds-file-button").length === 2, 20000)'`:
   `true`, both back.
9. **The hub's Open in Builds** — low-confidence: the self-test has no session row with a build (08). Start the demo
   with `key Space d d` (`<Leader>dd`, `demo.togglePanel`, in `src/plugins/keymap.ts`): the output holds
   `[demo] run started`. Give the Demo panel the keys (`key <A-h>` until the output holds `[demo] panel focused`),
   then `key j` until it holds `[demo] cursor on builds.session`, then `key Enter`: `[demo] went to builds.session`.
   If the panel takes the keys another way, record the route in Proof. The hub shows the sample builds: screenshot it;
   each build has an `Open in Builds` button. `click '.session-body:not([hidden]) .builds-open-in-builds'` (the
   first hub build): Builds mode shows, Sky Hop's entry is selected, the list cursor is on `sky-105`, and the detail
   pane shows its three-column graph with `Build iOS` selected (screenshot). Leave the demo (`key Space d x`,
   `[demo] run stopped`).
10. **Reload keeps the place** — low-confidence: the restore runs at a page start, which only the start test fakes.
    In Builds mode, select `game-a`, put the list cursor on `game-a-2`, and select its `deploy` job (`key <A-l>`,
    then `key l`: `[builds] job cursor on deploy`), then reload (Decisions). After
    the reload, `eval 'document.querySelector(".builds-job-box.is-selected")?.dataset.jobId'` returns `deploy`,
    `game-a` is the selected side-bar entry and the list cursor is on `game-a-2` (`query '.builds-row.is-selected'`).
11. **The real TeamCity backend** — low-confidence: every other check runs the `fixture` backend, and 03's
    `chain-*.json` test files are hand-edited to the new `DETAIL_FIELDS` shape, so a wrong field name passes every
    unit test. Read-only: this check queues, cancels and changes nothing in TeamCity; it presses no queue, set or
    cancel key. After `quit --run builds-fixture`, start a second run with the user's settings: `npm run drive --
    start --run builds-work --user-config`, `resize 1400 900`, define `waitUntil`, `key Space k m`, and wait for the
    `work` backend's first list (`eval 'waitUntil(() => document.querySelector(".builds-row"), 20000)'`). Select Tiki
    Smash in the side bar and put the list cursor on a Dev build that lists jobs (a finished one; note its TeamCity
    build id from `[builds] list cursor on work/<build id>`), then `key <A-l>`: `[builds] graph on work/<build id> job
    <job id>`. Screenshot the graph; `query '.builds-job-box'` for each box's `data-job-id` and label, and
    `query '.builds-graph-arrows path'` for the arrow count. In Bash, run `teamcity run tree <build id>` (read-only)
    and compare: each job of the chain is one box, each box's arrows come from exactly the jobs the tree shows it
    directly depending on, and finished boxes show `ran <duration>`. The panel's `TeamCity ↗` for a job reads that
    job's own page (`query` the panel's link target, or the `builds.openLink` line on a click). Then step to the
    `Deploy Android` box, `key s`, and wait for `[builds] download work/<build id>/log/<job id> saved <file name>`
    (`npm run drive -- log` and search its output). Read `<run home>/Downloads/<file name>`: about 70 KB, and its text
    holds a `zipfile:` line. `quit --run builds-work`. A missing `work` backend or Tiki Smash game in the user's
    settings, or a `teamcity` CLI not logged in, is a blocker recorded in Proof, not a failure.

Dropped:
- Keys reaching the graph and h/j/k/l along the arrows, `s` saving a log under its pinned name, `s` downloading one
  file, and the stacked Alt+j/Alt+k: pinned by the `builds` self-test groups `graph`, `saves` and `narrow` (08). Check
  5 keeps only the on-screen ring, which no self-test step sees.
- The graph's columns, edges, default job and moves: pinned by `job-graph.test.ts` (06).
- `showBuild`'s selection: pinned by `start.test.ts` `'shows a build from the hub'` (07); check 9 keeps the button.

Not checked here: the end-of-run placement check needs a whole `npm run selftest` (AGENTS.md § Running and testing),
which runs only on the user's ask; it is the one check that every new bind has an anchor. Finder opening on the saved
file is the user's: a drive run reveals nothing.

Done when: every check above has its result and screenshot path in Proof; each failure is fixed and its check run again.
Commit:    none, unless a check's fix changes code (then one commit per fix, with the fix)

## Proof

Commit e18895dd · proof: Live session: checks 2-11 pass; check 1 failed on 640 px job boxes (space-8 read as 8 px), fixed in e18895dd and re-run: three boxes and both arrows fit the 360 px pane, arrows join box edges exactly; saved place returns after a page reload and a builds plugin restart (core.restartPlugin), All and game entries · concerns: S3 empty s/o hints under --user-config come from the user's keys.showHints false, not the app; check 11 draws the transitive reduction of the TeamCity tree, by task 03's design
