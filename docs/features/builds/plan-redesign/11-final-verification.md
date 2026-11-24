# 11 — Final verification

Status: not started
Type: Task
Wave: 6 · Depends on: 10 (it checks the landed code after the doc re-read; every code task is behind 10)
Plan: [plan.md](plan.md)

All paths are from the repo root. `wigley:make` walks this task in its live session after the test gate.

Files:     none (a drive run writes only its own `.drive/<run id>/` folder, which is git-ignored)
Consumes:  the landed 01–08; the `fixture` backend kind in a drive run, and its `saveLog` (08); the demo's
           `builds.mode` and `builds.session` steps (08)
Produces:  each check's result with its screenshot path, in this task's Proof section

Decisions:
- Every check runs through one drive run (`.agents/skills/drive/SKILL.md` § Loop): `npm run drive -- start`, then
  the steps below, then `npm run drive -- quit`. Read each screenshot with the Read tool against `DESIGN.md` § Surfaces
  (the Builds bullet as task 10 left it), § Keys and focus and § Space, size and shape.
- **Fixture data.** After `start`, write `<run home>/fixture-drive/game-a-1.zip` (any text) with the Write tool, the
  run home being the `home` folder `start` prints. Then `npm run drive -- setting builds.backends '<json>'` with one
  backend: `{ "id": "fixture", "kind": "fixture", "label": "Fixture", "config": {}, "games": [{ "id": "game-a",
  "label": "Game A", "defaultBranch": "main", "kinds": { "dev": { "label": "Dev", "target": "dev", "downloads": [{
  "label": "Android zip", "path": "~/fixture-drive/game-a-{number}.zip" }, { "label": "Symbols", "path":
  "~/fixture-drive/game-a-{number}.zip" }] } } }] }`. The two downloads point at one file, so `game-a-1` has two
  files and `s` opens the picker. Wait for the line `backends applied: fixture 1 games`. Show Builds mode with
  `Space k m`.
- The fixture's `game-a-2` moves one step per list (10 s while the mode shows): wait for its third list (the build
  shows Failed) before the graph checks, so the jobs hold their final states.
- A check the self-test already pins is dropped (Dropped, below).
- Run no `npm run selftest` here: the test gate has run it.

Checks:

1. **Detail pane and graph** — expected. Select `game-a`, give the keys to the graph (`Alt+l`, `Alt+l`), and
   screenshot. The list sits at the start, the detail pane at the end. The header shows `Game A Dev #2`, the branch,
   the state Tag `Failed`, `Fixture ↗`. The graph shows `Build Android` and `iOS build` in column 0 and `Deploy` in
   column 1, an arrow from each of the two to `Deploy`, `iOS build` with the focus ring and
   `list-active-background`. The panel under the graph shows `iOS build`, `Failed`, `ran 15s`, `Archive failed`,
   `Log ↓` with its `s` hint and `Fixture ↗` with its `o` hint.
2. **Arrows after the mode was hidden** — low-confidence: the arrows are measured from laid-out boxes (07), and a
   draw while the mode was hidden measures nothing until the `ResizeObserver` fires. Show Sessions mode
   (`Space k s`), wait for one more poll of the fixture, show Builds mode again, and screenshot: every arrow joins its
   two boxes.
3. **Sideways scroll** — low-confidence: no test sees overflow. Drag the split handle (`drag`) to leave the detail
   pane about 380 px wide, then `query .builds-graph` for its `scrollWidth` and `clientWidth`: the graph scrolls
   (`scrollWidth > clientWidth`), and each box keeps its width (`query .builds-job-box` before and after: equal
   `width`). `l` to `Deploy` scrolls it into view: screenshot.
4. **Narrow window** — low-confidence: the stacking comes from the split's own CSS, never seen with this page.
   `resize` to 600 × 800 and screenshot: the list above the detail pane, no handle, nothing clipped sideways but the
   graph's own scroll. `Alt+j` from the list moves the keys to the graph and `Alt+k` back (the log's `focus graph`
   and `focus list`). `resize` back.
5. **Keys** — expected. In the graph: `k`, `l`, `h`, `j` log `job cursor on build-android`, `deploy`,
   `build-android`, `ios`, the ring moving with each; `Esc` gives the keys to the list. In the list, `j`/`k` move the
   cursor and the detail pane follows at once. `Enter` on a build gives the keys to the graph.
6. **Log save** — expected. On `iOS build`, `s`. The panel shows `Saving…` then the `Saved` Tag and
   `Game-A-Dev-2-iOS-build.log`; the log holds `download fixture/game-a-2/log/ios saved Game-A-Dev-2-iOS-build.log`
   and the core's reveal line (01: a drive run logs the reveal and opens nothing). Read
   `<run home>/Downloads/Game-A-Dev-2-iOS-build.log`: it reads `fixture log of game-a-2 ios`. Press `s` again: the
   new file is `Game-A-Dev-2-iOS-build (2).log`.
7. **File download through the picker** — low-confidence: the two-file path runs no self-test step. In the list on
   `game-a-1`, `s`: the picker opens titled `Download a file` with `Android zip` and `Symbols`; `Enter` on the first.
   The header's `Android zip ↓` button shows `Saved` and `game-a-1.zip`; `<run home>/Downloads/game-a-1.zip` exists.
   Click `Symbols ↓` (`click`) with the file already in Downloads: it saves as `game-a-1 (2).zip`.
8. **A file that goes away** — low-confidence: no test polls a file away and back. Delete
   `<run home>/fixture-drive/game-a-1.zip`, wait one poll, and check the header: the file buttons are gone, since a
   file shows only once it exists (plan.md). Write it again; after one poll they are back.
9. **The hub's Open in Builds** — low-confidence: the self-test has no session row with a build (08). Enter the
   demo's `builds.session` step through the Demo panel (`Space d d` opens it: `<Leader>dd` in `src/plugins/keymap.ts`),
   so the hub shows the sample builds. Screenshot the hub: each build has an `Open in Builds` button. Click the first
   (`click`): Builds mode shows, Sky Hop's entry is selected, the list cursor is on `sky-105`, and the detail pane
   shows its three-column graph with `Build iOS` selected. Leave the demo.
10. **Reload keeps the place** — low-confidence: the restore runs at a page start, which only the start test fakes.
    In Builds mode, select `game-a-2` and its `deploy` job, then reload the page (a page edit's hot reload, or the
    drive's reload command if `npm run drive -- help` lists one). After the reload `game-a` is shown, the cursor is
    on `game-a-2` and `Deploy` carries `is-selected` (`query`).

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

