# 08 — Demo, self-test and README

Status: not started
Type: Task
Rung: hard · the self-test steps run against a fixture that changes on each poll, so their order and lines are a timing choice no pattern settles
Wave: 4 · Depends on: 07
Plan: [plan.md](plan.md)

All paths are from the repo root.

Files:
- modify `src/plugins/builds/page/demo-sample.ts`
- modify `src/plugins/builds/page/demo-steps.ts`
- modify `src/plugins/builds/page/start.ts`
- modify `src/plugins/builds/main/fixture-backend.ts`
- modify `src/plugins/builds/main/selftest-script.ts`
- modify `src/plugins/builds/main/start.ts`
- modify `README.md`
- modify `CHANGELOG.md`

Consumes:
- `BuildJob.webUrl`, `startedAt`, `finishedAt`, `dependsOn` · `BackendCapabilities.saveLog` · `BuildBackend.saveLog?(game, buildId, jobId, path)` · `GameView.files` · `BuildKindEntry.downloads` ← 02
- main's file checks fill `GameView.files` on each poll of a game, and main runs `saveLog` and `download` into
  `MainServices.downloadsDir`, which is `<homeDir>/Downloads` in the self-test and a drive run ← 01, 05
- the saved log's name rule and the kept file name (plan.md Pinned values) ← 05
- the page's log lines `shown`, `game cursor on <key>`, `shown <key>`, `focus <scope>`,
  `graph on <build key> job <job id>`, `job cursor on <job id>`, `list cursor on <key>`, `saving <download id>`,
  `download <id> saved <file name>`; the scope `builds.graph` and its keys; `BuildsView.selectBuild` ← 07

Produces:
- `BuildsSelfTestDeps` (in `src/plugins/builds/main/selftest-script.ts`) gains
  `writeHomeFile(path: string, text: string): Promise<void>` — writes `text` at `path` under the home folder
- `BuildsDemoPageDeps` (in `src/plugins/builds/page/demo-steps.ts`) gains `selectBuild(key: string): void`

## Decisions

**Demo sample** (`page/demo-sample.ts`; AGENTS.md Intent: every feature has a demo step, and a changed look lands with
its step updated).
- `capabilities` of the `Sample CI` backend: `{ cancel: true, choosesBranch: true, saveLog: true }`.
- Every sample kind gets `downloads: []`. `GameView.files` of Sky Hop: `{ 'sky-104': [{ label: 'Android zip', path:
  '/sample/sky-hop/1.4.0/android_SkyHop_1.4.0.104.zip' }] }`; of Word Garden: `{}`.
- `sampleJob` defaults gain `webUrl: null`, `startedAt: null`, `finishedAt: null`, `dependsOn: []`.
- `sky-105` (running) gets five jobs, in this order. Each `webUrl` is `https://ci.example.com/sky-hop/105/<job id>`.

  | id | label | state, result | percent, leftSeconds, stepText | startedAt, finishedAt | dependsOn |
  |---|---|---|---|---|---|
  | `build-android` | `Build Android` | finished, success | — | `now - 11 min`, `now - 5 min` | `[]` |
  | `build-ios` | `Build iOS` | running, null | 60, 420, `Building the iOS player` | `now - 11 min`, null | `[]` |
  | `deploy-android` | `Deploy Android` | finished, success | — | `now - 5 min`, `now - 3 min` | `['build-android']` |
  | `deploy-ios` | `Deploy iOS` | queued, null | — | null, null | `['build-ios']` |
  | `notify` | `Notify` | queued, null | — | null, null | `['deploy-android', 'deploy-ios']` |

  So the graph has three columns, and the default job is `build-ios`.
- `word-58`'s `tests` job gets `webUrl: 'https://ci.example.com/word-garden/58/tests'`, `startedAt: now - 24 min`,
  `finishedAt: now - 9 min`.
- Update `demoSample`'s comment for the jobs and the file.

**Demo step** (`page/demo-steps.ts`, `page/start.ts`).
- The `builds.mode` step gains a second beat, `build`, after `game`: `deps.selectBuild('sample/sky-105')`. The detail
  pane then shows the running build's graph.
- `start.ts` passes `selectBuild: (key) => view.selectBuild(key)` to `registerDemoSteps`.
- The step's `files` gain `src/plugins/builds/page/job-graph.ts`. Its caption becomes:
  `Builds: the CI and local builds of tracked games, each build's jobs as a graph, queued in one press and followed live.`

**Fixture backend** (`main/fixture-backend.ts`).
- `create(entry, services)` passes `services.files` to the backend.
- `capabilities`: `{ cancel: true, choosesBranch: false, saveLog: true }`.
- `saveLog(game, buildId, jobId, path)` writes `fixture log of <buildId> <jobId ?? 'build'>\n` at `path` through
  `files.write`.
- Build `<game id>-2` (`movingBuild`) lists three jobs, in this order, on every call. Each job's `webUrl` is
  `https://fixture.example.com/<game id>-2/<job id>`; the build's own `webUrl` is
  `https://fixture.example.com/<game id>-2`.

  | id | label | call 1 | call 2 | call 3 and later | dependsOn |
  |---|---|---|---|---|---|
  | `build-android` | `Build Android` | finished success | the same | the same | `[]` |
  | `ios` | `iOS build` | running | finished failure, `Archive failed` | the same | `[]` |
  | `deploy` | `Deploy` | queued | queued | finished cancelled | `['build-android', 'ios']` |

  Times: `build-android` starts at `createdAt - 20_000` and finishes at `createdAt - 10_000`; `ios` starts at
  `createdAt - 20_000` and, once failed, finishes at `createdAt - 5_000`. `deploy` has no times.
- The `ios` job keeps its id, label and failure text, so the endings group's lines stay as they are.
- Update the file's header comment for the jobs, `saveLog` and the capability.

**Fixture in a drive run** (`main/start.ts`). The fixture kind registers when `services.runMode !== 'live'`, so a
drive run (task 11) gets the `fixture` kind too. The script still hands over only while `services.selfTest` is not
null. `main/start.ts` passes `writeHomeFile: (path, text) => services.files.write(services.paths.join(services.homeDir,
path), text)` to the script.

**Self-test script** (`main/selftest-script.ts`; AGENTS.md § Running and testing, the step fields).
- `GAME_A`'s kind: `dev: { label: 'Dev', target: 'dev', downloads: [{ label: 'Android zip', path:
  '~/fixture-drive/game-a-{number}.zip' }] }`. Build `game-a-1` (number `1`) then has one file; `game-a-2` has none,
  since `~/fixture-drive/game-a-2.zip` is never written.
- `open()` first writes `fixture-drive/game-a-1.zip` with the text `fixture zip\n` through `writeHomeFile`, then adds
  the link as today, then logs `self-test link added`. The shown line waits for the write, so the file exists before
  the setting step adds the backend.
- New groups, after `endings`, in this order. `endings` ends once `game-a-2` has finished, so the jobs hold their
  call-3 states: `build-android` success, `ios` failed, `deploy` cancelled. The graph is
  `[['build-android', 'ios'], ['deploy']]` and the default job is `ios` (no job runs; `ios` is the first failed).
  Each `expect` below is the full line, `[builds] ` first.

  Group `graph`, why: `Space k m shows Builds mode; Alt+l walks the game list, the build list and the job graph, and
  h/j/k/l step between the jobs along the arrows.`

  | keys | expect | alsoExpect | screenshot |
  |---|---|---|---|
  | `' ', 'k', 'm'` | `[builds] shown` | | |
  | `j` | `[builds] game cursor on fixture/game-a` | | |
  | `Enter` | `[builds] shown fixture/game-a` | | |
  | `<A-l>` | `[builds] focus list` | | |
  | `<A-l>` | `[builds] graph on fixture/game-a-2 job ios` | `/^\[builds\] focus graph$/` | `graph` |
  | `k` | `[builds] job cursor on build-android` | | |
  | `l` | `[builds] job cursor on deploy` | | |
  | `h` | `[builds] job cursor on build-android` | | |
  | `j` | `[builds] job cursor on ios` | | |

  Group `saves`, why: `s in the graph saves the job's log under its pinned name, and s on a build downloads its one
  file, each into the Downloads folder.`

  | keys | expect | alsoExpect | screenshot |
  |---|---|---|---|
  | `s` | `[builds] saving fixture/game-a-2/log/ios` | `/^\[builds\] download fixture\/game-a-2\/log\/ios saved Game-A-Dev-2-iOS-build( \(\d+\))?\.log$/` | `log-saved` |
  | `Escape` | `[builds] focus list` | | |
  | `j` | `[builds] list cursor on fixture/game-a-1` | | |
  | `s` | `[builds] saving fixture/game-a-1/file/0` | `/^\[builds\] download fixture\/game-a-1\/file\/0 saved game-a-1( \(\d+\))?\.zip$/` | `file-saved` |

  The ` (2)` suffix in the patterns covers a second run in one temp home (plan.md: a taken name gets ` (2)`).

  Group `narrow`, why: `In a narrow window the list and the detail stack, and Alt+j and Alt+k move between them.`

  | width | keys | expect | alsoExpect | screenshot |
  |---|---|---|---|---|
  | `600` | `<A-j>` | `[builds] graph on fixture/game-a-1 job build` | `/^\[builds\] focus graph$/` | `stacked` |
  | | `<A-k>` | `[builds] focus list` | | |
  | `'start'` | `<A-l>` | `[builds] graph on fixture/game-a-1 job build` | `/^\[builds\] focus graph$/` | |

  `game-a-1` lists no job, so its graph line names `build`. The last step puts the width back, as every script ends
  on the start width.
- The hub's Open in Builds gets no self-test step: the script's link names a session with no row, so no hub draws
  its build. `start.test.ts`'s `'shows a build from the hub'` (07) covers the command, and
  [11-final-verification.md](11-final-verification.md) clicks the button.
- The end-of-run placement check (AGENTS.md § Architecture, Key hints) sees `builds.games`, `builds.list` and
  `builds.graph` in force for the first time. It runs only in a whole self-test run, which runs only on the user's
  ask. A filtered run skips it; 11 names it.

**README** (AGENTS.md § README, changelog and boundary).
- The `builds` row of the Built-in plugins table reads: `Builds mode: the CI and local builds of the tracked games,
  queued in one press, with each build's jobs as a graph and its logs and files saved to Downloads; each session's
  builds on its row and in its hub, and a build offer above its composer.` Re-pad the table's cells to the longest
  row.
- The `builds.backends` bullet reads: `` `builds.backends` — the build backends this machine uses (`teamcity` or
  `local`), each with the games it tracks, their build kinds (each with the files it offers for download, as
  `downloads`) and their sets. An agent adds a game on the user's ask. ``

**CHANGELOG**, under `## Unreleased`, for the whole plan:

```
### Added

- Builds mode shows the selected build beside the list: its links, its files and its jobs as boxes with arrows from
  each job's prerequisites. `Alt+l` or `Enter` moves into the graph, `h`/`j`/`k`/`l` step between the jobs, `s` saves
  the job's log to Downloads and `o` opens the job's own page in the backend.
- A tracked game's kinds take `downloads`: files such as a build's Android zip in a synced Drive folder. Each shows as
  a button once it exists, and `s` on a build copies it to Downloads and shows it in Finder or Explorer.
- Local builds save their log too.
- A build's finish message names the path of each file the build has ready.
- Each build in the session hub has an Open in Builds button.

### Changed

- `Enter` on a build moves the keys into its job graph; the build's detail no longer opens under its row.
```

GIVEN the demo's Builds step WHEN its `build` beat shows THEN the detail pane shows `sky-105`'s graph in three columns with `build-ios` selected
GIVEN a drive run WHEN `builds.backends` names a backend of kind `fixture` THEN it applies with no problem
GIVEN the self-test WHEN group `saves` runs THEN `<home>/Downloads` holds the log and the zip, and the page logs each one saved

Tests:     no Vitest test: the sample and the fixture are data. The self-test groups above are the check:
           `npm run selftest -- --plugin builds`, filtered (AGENTS.md § Running and testing). The demo's own script
           walks the `builds.mode` step and fails on a throw: `npm run selftest -- --plugin demo`.
Done when: compiles; the filtered `builds` and `demo` self-test runs pass; `npm run lint` passes its changelog, boundary and
           README checks (the README coverage test is `scripts/readme-coverage.test.mts`).
Commit:    one commit for the group

## Proof

