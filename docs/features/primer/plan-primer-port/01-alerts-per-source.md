# 01 — Alerts open count per source

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Rules: every rule in [plan.md § Rules for every task](plan.md#rules-for-every-task) applies.

The badge count becomes the sum of one count per source. Today forms sets the one global number; after this task
each caller names its source, and the electron adapter keeps each source's latest count and shows their sum. Task 02
moves the forms caller into the shared presenter; this task changes only its call site.

Files:     modify `src/contracts/alerts.ts` · modify `src/main/alerts/electron-alerts.ts` ·
           create `src/main/alerts/open-counts.ts` · test `src/main/alerts/open-counts.test.ts` (create) ·
           modify `src/plugins/forms/main/channel-presenter.ts` (call site only) ·
           modify `src/plugins/forms/main/channel-presenter.test.ts` (its fake `Alerts` only) ·
           check `src/main/alerts/silent-alerts.ts` (no edit expected)

Consumes:  `Alerts` in `src/contracts/alerts.ts` (tree) ·
           `createChannelPresenter` in `src/plugins/forms/main/channel-presenter.ts` (tree)

Produces:  in `src/contracts/alerts.ts`, word for word from `plan.md` § Shared names:

```ts
export interface Alerts {
  announce(title: string, body: string, onClick: () => void): void;
  // `source` names the caller (a plugin id); the badge shows the sum of every source's count.
  setOpenCount(source: string, count: number): void;
}
```

           Keep the existing comment above `announce` (`` // `onClick` runs when the user clicks the alert, where the
           platform supports it. ``) and the file's header comment.

           in `src/main/alerts/open-counts.ts`:

```ts
// Each source's latest open count; `set` records one and returns the sum over every source.
export function createOpenCounts(): { set(source: string, count: number): number };
```

Decisions:
- No test file sits beside `electron-alerts.ts` (checked: `src/main/alerts/` holds only `electron-alerts.ts` and
  `silent-alerts.ts`), so the summing goes into `open-counts.ts` with its own test, as `plan.md` § Files by task
  says. `electron-alerts.ts` imports Electron, so the sum is kept out of it to stay testable under Vitest.
- `createOpenCounts` keeps a `Map<string, number>`. `set` replaces the source's earlier count. A source set to 0
  stays in the map at 0; the sum does not change by keeping it.
- `electron-alerts.ts` (`setOpenCount` at lines 75–82, measured at plan time, re-verify) creates one
  `createOpenCounts()` per adapter and shows the returned total where it shows `count` today: `app.setBadgeCount(total)`
  on macOS, and on Windows the overlay dot when `total > 0`.
- The Windows overlay description names forms only today (`` `${count} open review rounds` ``, line 79). The
  primer also counts now, so it becomes `` `${total} open agent forms` ``, and `''` when `total` is 0.
- `silent-alerts.ts` sets `setOpenCount: () => {}`, which already satisfies the new signature. Leave it unchanged.
- The forms call site (`channel-presenter.ts` lines 37–40) passes the source `'forms'`:
  `alerts.setOpenCount('forms', <the same count as today>)`. Nothing else in the presenter changes.
- `channel-presenter.test.ts` line 82 (`setOpenCount: (count) => counts.push(count)`) reads the source as the count
  under the new signature. Change the fake to record both: `setOpenCount: (source, count) => counts.push([source, count])`
  (or two arrays), and make each existing assertion on `counts` check the same numbers with source `'forms'`. Every
  test keeps its meaning.

GIVEN source `forms` set to 2 and source `primer` set to 1 WHEN `set('primer', 1)` runs THEN it returns 3
GIVEN source `forms` set to 2 WHEN `set('forms', 0)` runs THEN it returns 0
GIVEN a forms round shown WHEN the presenter counts it THEN `setOpenCount` receives `('forms', 1)`

Tests:     `src/main/alerts/open-counts.test.ts` (new):
           - `sums the latest count of every source` — `set('forms', 2)` returns 2, then `set('primer', 1)` returns 3.
           - `replaces a source's earlier count` — `set('forms', 2)`, `set('forms', 5)` returns 5.
           - `returns zero once every source is back to zero` — `set('forms', 2)`, `set('primer', 1)`,
             `set('forms', 0)` returns 1, then `set('primer', 0)` returns 0.
           `src/plugins/forms/main/channel-presenter.test.ts`: the existing tests, their count assertions now
           checking source `'forms'` beside each number.

Approach:  `open-counts.ts` imports nothing. It is in the `src/main/alerts` layer, which allows `src/contracts` and
           `electron` only (`scripts/check-layers.mts` line 52); a `.test.ts` file may also import `vitest`.

Done when: `npm run typecheck` and `npm run lint` pass; the gate runs `npm test -- src/main/alerts/open-counts.test.ts`
           and `npm test -- src/plugins/forms/main/channel-presenter.test.ts`. The badge on the real Dock and taskbar is
           checked in task 14 (Final verification), not here.
Commit:    one commit for the group in wigley-ai-gui

## Proof
