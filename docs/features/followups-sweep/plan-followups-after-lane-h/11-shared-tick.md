# 11 — Shared tick and fake timers

Status: done
Type: Task
Rung: hard · adds the shared tick and fakeTimers seam other tests consume and moves four timer lifecycles
Wave: 5 · Depends on: 07, 08 (each lists `src/plugins/chat/page/entry-list.test.ts`), 10 (both list `src/shared/page/ui/split.test.ts`)
Plan: [plan.md](plan.md)

Fixes follow-up **One shared tick and one shared `fakeTimers`** (`docs/features/followups.md`; find it with
`grep -n -F` on the title): the block "one pending one-shot, set while needed, clear when not" has four copies (`pendingTick` in
`chat/page/row-clock.ts`, `agent-strip/page/agent-strip.ts`, `workflow/page/workflow-view.ts`,
`agent-lines/page/working-lines.ts`), and the `fakeTimers` test helper has many. Give each one home in `src/shared`.

**Shared file**: `src/shared/page/ui/split.test.ts` is also in task 10's Files, so this task runs in wave 4, on
task 10's landed copy of it (wave 3).

Files:
- create `src/shared/pending-tick.ts`
- test `src/shared/pending-tick.test.ts`
- create `src/shared/fake-timers.test-support.ts`
- modify `src/plugins/chat/page/row-clock.ts`
- modify `src/plugins/agent-strip/page/agent-strip.ts`
- modify `src/plugins/workflow/page/workflow-view.ts`
- modify `src/plugins/agent-lines/page/working-lines.ts`
- test `src/renderer/plugins/page-api.test.ts`
- test `src/renderer/page-keys.test.ts`
- test `src/plugins/forms/page/autosave.test.ts`
- test `src/plugins/chat/page/activity-dock.test.ts`
- test `src/plugins/chat/page/composer-kit.test.ts`
- test `src/plugins/chat/page/entry-list.test.ts`
- test `src/plugins/chat/page/row-clock.test.ts`
- test `src/plugins/keys/page/which-key-controller.test.ts`
- test `src/shared/page/ui/split.test.ts`
- test `src/main/plugins/main-api.test.ts`
- test `src/shared/tracked-timers.test.ts` (rename only, below)

Preconditions (run from the `wigley-ai-gui/` folder of the merged `main`):

| Claim | Command | Expected |
|---|---|---|
| Four tick copies | `grep -rln 'let pendingTick' src --include='*.ts'` | `row-clock.ts`, `agent-strip.ts`, `workflow-view.ts`, `working-lines.ts` |
| Each copy is the same set-while-needed block, with the tick clearing `pendingTick` first | `grep -rn -A1 'const tick = () => {' src/plugins/chat/page/row-clock.ts src/plugins/agent-strip/page/agent-strip.ts src/plugins/workflow/page/workflow-view.ts src/plugins/agent-lines/page/working-lines.ts` | each next line is `pendingTick = null;` |
| The test copies | `grep -rln 'function fakeTimers()' src` | the ten test files above plus `src/shared/tracked-timers.test.ts` (the item's `renderer/toasts.test.ts` copy is gone already) |
| No shared home yet; `tracked-timers.ts` is a plugin's tracked view of timers, not a tick | `ls src/shared/pending-tick.ts src/shared/fake-timers.test-support.ts 2>&1 \| grep -c 'No such'`; `grep -n '^export' src/shared/tracked-timers.ts` | `2`; `MAX_TIMER_MS` and `trackedTimers` only |
| Every importer's layer admits `src/shared` | `grep -n "'src/shared'" scripts/check-layers.mts scripts/layer-rules.mts \| head` | listed for `src/main`, the renderer and page layers, and every plugin |

Consumes: nothing from another group. Follows 07 (wave 1) and 06 (wave 2) in `entry-list.test.ts` (same file) and task 10 in
`split.test.ts` (above).

Produces:
- In `src/shared/pending-tick.ts`:
  `export interface PendingTick { setNeeded(isNeeded: boolean): void; }` and
  `export function createPendingTick(timers: Timers, ms: number, run: () => void): PendingTick`
- In `src/shared/fake-timers.test-support.ts`:
  `export function fakeTimers(): { timers: Timers; armed: Map<number, { run: () => void; ms: number }>; cleared: number[]; fireAll(): void; runAfter(ms: number): void }`

Decisions:
- **The tick's shape.** `createPendingTick` holds one pending handle. `setNeeded(true)` sets `timers.set(fire, ms)`
  when none is pending; `setNeeded(false)` clears a pending one; otherwise it does nothing. `fire` drops the handle,
  then calls `run`, so `run` (each site's `tick`) decides again through its own `updateTick`/`updateTicker`. No
  `dispose`: no site clears its tick on teardown today, since the plugin's `trackedTimers` clears pending timers when
  the plugin's registrations dispose; adding one would change behaviour beyond the item. Comment: "One pending
  one-shot of `run` after `ms`, kept while needed: `setNeeded(true)` sets it when none is pending, `setNeeded(false)`
  clears a pending one. The handle is dropped before `run`, so `run` may ask for the next tick." It lives in
  `src/shared/` beside `tracked-timers.ts`, since `Timers` serves either process.
- **Each site.** `let pendingTick: number | null = null;` becomes `const ticker = createPendingTick(timers, TICK_MS,
  () => tick());` (the arrow defers the lookup of `tick`, declared below). `updateTick`/`updateTicker` becomes
  `ticker.setNeeded(<its condition>)` with the site's comment kept ("Sets the tick while … ; clears a pending one once
  …"). Each `tick` drops its `pendingTick = null;` line. Each site's `TICK_MS` stays its own (each names its own
  cadence).
- **The fake's shape: the union of the copies' members.** Handles number from 1. `armed` holds each pending timer's
  run and delay by handle; `clear` removes it from `armed` and records the handle in `cleared`. `fireAll` runs every
  armed timer once, emptying `armed` first, so a timer set while they run waits for the next call. `runAfter(ms)`
  runs and removes each armed timer set for exactly `ms`, none set while they run. Comment states each.
- **The copies moved.** Each file deletes its `function fakeTimers()` and imports the shared one; call sites change
  only where a member's name or value differs:
  - `page-keys.test.ts`, `activity-dock.test.ts`, `entry-list.test.ts`, `row-clock.test.ts`, `split.test.ts`,
    `page-api.test.ts`: none (they read `armed.size`, `fireAll`, `cleared`, or `armed`'s `{ run, ms }`).
  - `composer-kit.test.ts`: `[...armed.values()].forEach((run) => run())` (two places) becomes `fireAll()`, taken
    from `fakeTimers()` in `surfaceDeps` and returned beside `armed`.
  - `autosave.test.ts`: `scheduled` becomes `armed`, `runDue` becomes `fireAll` (same semantics).
  - `which-key-controller.test.ts`: `scheduled` becomes `armed`; `runAfter` is the same.
  - `main-api.test.ts`: its `fireAll` ran timers without removing them; its one use fires once, so the shared one
    serves.
- **Left out**: `src/shared/tracked-timers.test.ts`'s `fakeTimers`. Its `fireAll` runs cleared timers too ("as a clear
  that came too late would"), which is the case that suite proves `trackedTimers` guards; the shared fake honours
  `clear`, so that suite keeps its own and renames it `lateClearTimers` with its comment, so the grep for the shared
  name finds one home.
- **Left out, other `Timers` fakes**: `workflow-large/main/countdown.test.ts`, `system-stats/main/poller.test.ts`,
  `usage/main/plan-poller.test.ts`, `unity-pool/main/pool-watch.test.ts`, `chat/main/tool-callers.test.ts`,
  `chat/main/start.test.ts` and `main/plugins/plugin-switch.test.ts` (`const fakeTimers`) keep their own: they carry
  other members and names, and are not the item's `function fakeTimers()` copies the precondition grep lists.

GIVEN a pending tick with `setNeeded(true)` called twice WHEN the timers are read THEN one timer is armed, for `ms`.
GIVEN an armed tick WHEN `setNeeded(false)` THEN its handle is cleared and nothing is armed; a further
`setNeeded(false)` clears nothing more.
GIVEN an armed tick whose `run` calls `setNeeded(true)` WHEN it fires THEN `run` ran once and one new timer is armed.
GIVEN nothing needed WHEN `setNeeded(false)` THEN nothing is set or cleared.

GIVEN each tick site's existing suite WHEN it runs THEN it passes unchanged: `row-clock.test.ts` (its `armed.size`
checks of the tick), `agent-strip.test.ts`, `workflow-view.test.ts`, `working-lines.test.ts`.

Tests:
- `pending-tick.test.ts`, describe `createPendingTick`: `it.each` `'$case'` rows — `'arms one timer however often it
  is needed'` (`armed` size 1, its `ms` the given 1000); `'clears a pending timer once not needed'` (`cleared` `[1]`,
  `armed` empty, a second `setNeeded(false)` leaves `cleared` `[1]`); `'a fired tick may ask for the next'` (`run`
  calls `setNeeded(true)`; after `fireAll`, runs 1 and `armed` size 1 with handle 2); `'not needed and not pending
  does nothing'` (`armed` empty, `cleared` empty). Over the shared `fakeTimers`.
- No test for the fake itself: each moved suite exercises its members.

Done when: compiles (`npm run typecheck`); `npm run lint` passes (the layer check); `npm test` runs
`pending-tick.test.ts`, the four tick sites' suites and the ten moved suites green;
`grep -rn 'pendingTick' src` prints nothing; `grep -rn 'function fakeTimers' src` prints only the shared file.

Commit: one commit, "Shared createPendingTick for the four set-while-needed ticks, and one fakeTimers in
src/shared for ten test copies (follow-up: One shared tick and one shared fakeTimers)".

## Proof

Commit d17f69752 · proof: diff read: createPendingTick replaces the four pendingTick copies (grep pendingTick src empty); shared fakeTimers replaces eleven suite copies (grep 'function fakeTimers' src prints only the shared file); typecheck and lint pass · concerns: toasts.test moved to the shared fake beyond Files; its draw-throws row now asserts armed.size 0, which also passes on a set-then-cleared timer
