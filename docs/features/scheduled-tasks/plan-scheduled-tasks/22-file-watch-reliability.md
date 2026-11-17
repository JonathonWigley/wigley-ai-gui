# 22 — File watches: rescan on a missed burst, and report a write's target

Status: in progress
Type: Batch
Wave: 1 · Depends on: none
Rung: hard · changes when the Node adapter reports a watch event, which every `Files.watch` consumer reads
Plan: [plan.md](plan.md)

Two follow-ups from `docs/features/followups.md` § Latent defects and tests, one batch because both make
`Files.watch` keep its promise that a change reaches the consumer:

- **Plugin main-part file watchers can miss a save on macOS.**
- **The Node files watcher can lose a rename's target.**

Files:     modify `src/main/files/node-files.ts` · test `src/main/files/node-files.test.ts` ·
           modify `src/contracts/files.ts` (the `watch` comment only) ·
           modify `src/plugins/workflow-large/main/plan-watch.ts` · test `src/plugins/workflow-large/main/plan-watch.test.ts` ·
           modify `src/plugins/workflow-large/main/plan-reports.ts` · test `src/plugins/workflow-large/main/plan-reports.test.ts` ·
           modify `src/plugins/unity-pool/main/pool-watch.ts` · test `src/plugins/unity-pool/main/pool-watch.test.ts` ·
           modify `src/plugins/docs/main/doc-files.ts` · test `src/plugins/docs/main/doc-files.test.ts` ·
           modify `src/plugins/practice/main/problem-store.ts` · test `src/plugins/practice/main/problem-store.test.ts` ·
           modify `docs/features/followups.md` (removes the two entries)

Consumes:  nothing from another task. Tree members: `WatchOptions.onMissed` and `Files.watch` (`src/contracts/files.ts`);
           `TEMP_FILE`, `watchDebounced`, `WATCH_QUIET_MS` (`src/main/files/node-files.ts`); `Files.modified(path)`.

Produces:  no new name. Behaviour: every plugin main-part watch below passes `onMissed`; the Node adapter reports a
           `write`'s target when the OS reports only the temp name. Task 11 (`task-store.ts`) already passes `onMissed`
           and reads the task file through `Files.write`, so it gets both fixes with no change.

Decisions:
- **Scope of the `onMissed` part.** The follow-up names five watches. The category is "a plugin main part that calls
  `files.watch` with no `onMissed`". This task covers every member found in the tree at plan time:
  - `workflow-large/main/plan-watch.ts`: the copy-folder watches (`onMissed` runs the same `read(sessionId, entry)`
    as `onChange`), the `worktrees` watch and the git-folder watch (`onMissed` runs `listAgain(sessionId, entry)`).
    Each calls `heard(entry, <folder>)` first, as its `onChange` does.
  - `workflow-large/main/plan-reports.ts` (not named by the follow-up; same category): see the plan-reports rule below.
  - `unity-pool/main/pool-watch.ts`: `onMissed: () => rescan()`, as its `onError` does.
  - `docs/main/doc-files.ts` `watch`: `onMissed: changed`. A file watch has no list to compare, so a missed burst
    reads as a change of the file; the consumer reads it again. Backlog's follow-up file watch goes through
    `docs.watchDoc`, which is this function, so backlog needs no edit of its own.
  - `practice/main/problem-store.ts`: `onMissed: () => onChange(null)`. The page's `changed` handler reloads the whole
    view for any slug (`src/plugins/practice/page/start.ts`, `view.reload()`), and `slug: null` already occurs.
  A watch found by `grep -rn "files.watch(\|\.watch(" src/plugins` that is not listed here and passes no `onMissed`
  is a concern to report, not to fix.
- **The plan-reports rule.** `createPlanReports` applies a report only when its file changes and does no scan at start,
  on purpose: an old report must not apply again. Its `onMissed` lists `folder` (`files.list`, non-recursive) and
  reads each `<row id>.json` whose `files.modified` time is later than the time the watch opened (from an injected
  `now()` dep, default `Date.now`), and later than the modified time this module last applied for that name. It keeps
  a `Map<name, number>` of the modified time it applied, filled by every `readReport`. Its deps gain
  `list`, `modified` and `now`. A list or stat that fails is logged as `plan report rescan failed: <errorText>`.
- **The temp-name rule (node-files.ts).** In `watchDebounced`, an event whose base name matches `TEMP_FILE` is no
  longer dropped. Its target is the same folder plus the name without the leading `.` and the `.<8 hex>.tmp` end. The
  event is debounced under the target's path, and marked "from temp only" unless an event for the target's own name
  arrives in the same quiet window. When the quiet window ends: a target marked "from temp only" is reported only
  when it exists then (`existsSync` of the joined absolute path); every other target is reported as today. Reason: a
  temp file `write` made and lost (a failed write) must report nothing, and a real write must report its target once.
  A name that matches `TEMP_FILE` but was not made by `write` follows the same rule; that is accepted.
- **Contract text.** Rewrite the sentence "A temp file `write` makes never reports, so a write reports only its
  target." in `src/contracts/files.ts` to say the adapter reports a write's target, also when the OS reports only the
  temp name, and never reports the temp name itself. Do not change the memory adapter.
- Every new `onMissed` runs the same read path as the watch's `onChange`, so no second read path is written.
- Test names follow each file's existing form (match the surrounding tests).

GIVEN a Node watch on a folder, and an OS event for `.tasks.json.0a1b2c3d.tmp` only, with `tasks.json` present
WHEN the quiet window ends
THEN `onChange` gets `tasks.json` once, and never the temp name

GIVEN the same event, with no `tasks.json` present when the window ends
WHEN the quiet window ends
THEN `onChange` gets nothing

GIVEN a plan-reports watch opened at time 1000, with `a.json` modified at 900 and `b.json` modified at 1500
WHEN `onMissed` runs
THEN only `b.json` is read and applied; a second `onMissed` with no new write applies nothing

GIVEN a unity-pool watch whose files changed while no event came
WHEN `onMissed` runs
THEN the pool state is read again as on `onError`

Tests:
- `node-files.test.ts`: the temp-name cases are pure decisions inside the handler; drive them through the adapter
  over a real temp folder by writing the temp name and renaming it, as the file's existing watch tests do. Rows:
  temp then rename (target once); temp only with the target present (target once); temp only with no target
  (nothing); target event and temp event in one window (target once). Break: a temp-only event that drops the target.
- `plan-watch.test.ts`, `pool-watch.test.ts`, `doc-files.test.ts`, `problem-store.test.ts`: one case each. The memory
  `Files` never calls `onMissed`, so wrap its `watch` in the test to capture the options and call `onMissed` by hand
  after a direct write the wrapper did not report. Assert the module read again (the state, the `changed` call or
  the slug `null`).
- `plan-reports.test.ts`: the third GIVEN/WHEN/THEN, with an injected `now` and the memory files' modified times.

Done when: `npm run lint` and `npm run typecheck` pass; `npm test` passes for the seven test files above. The two
follow-up entries ("Plugin main-part file watchers can miss a save on macOS" and "The Node files watcher can lose a
rename's target") are gone from `docs/features/followups.md`. No live check: task 21 already watches the task file
through a real write.

Commit:    one commit for the group: "File watches rescan on a missed burst and report a write's target".

## Proof

