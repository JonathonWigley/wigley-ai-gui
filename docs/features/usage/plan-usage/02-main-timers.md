# 02 — Main timers

Status: in progress
Type: Task
Wave: 2 · Depends on: 01 (shares `src/contracts/plugin.ts`)
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/plugin.ts` · modify `src/contracts/ambient.ts` (comment only) · modify `src/main/main.ts`
Consumes:  `Timers` in `src/contracts/ambient.ts` (in the tree: `set(run: () => void, ms: number): number; clear(handle: number): void`)
Produces:  `MainServices.timers: Timers` in `src/contracts/plugin.ts`
           the composition root's live `timers: Timers` in `src/main/main.ts`, passed in the services object `startMainParts` receives
Decisions: **no move**: `Timers` already lives in `src/contracts/ambient.ts` beside `Clock`, and every importer imports it from there. No import changes. The `./ambient` import in `plugin.ts` already holds `Timers` (for `PageServices.timers`) and needs no change
           **the member**: `timers: Timers` goes directly after `clock: Clock` in `MainServices`. The doc comment above `MainServices` gains one sentence: `timers` runs one-shot timers, the page's `Timers` seam
           **the `Timers` comment** in `ambient.ts` says "The page's timers" now; after, it says the timers of either process, one-shot: `set` runs `run` once after `ms` and returns a handle, `clear` cancels a handle `set` returned
           **the live adapter** in `main.ts` is one module-level `const timers: Timers` beside the existing `const clock: Clock`. It imports `setTimeout` and `clearTimeout` from `node:timers`, so the types are Node's and not the DOM's. `set` returns `setTimeout(run, ms)[Symbol.toPrimitive]()`, the Timeout's numeric id; `clear` passes the number to `clearTimeout`, which Node accepts in place of the Timeout object. This matches the page's adapter in `src/renderer/renderer.ts` (one-shot `window.setTimeout` / `window.clearTimeout`)
           **where it is passed**: `main.ts` builds `MainServices` once, the object literal handed to `startMainParts` in the window-ready path (beside `clock`, `randomHex`, `randomUuid`). Add `timers` there, after `clock`. Self-test and drive runs use the same object (their differences come from `modeServices.forWindow`), so they get the live timers too, as they get the live `clock`. Reference members, not line numbers: the peer plan `docs/features/agent-chat/plan-activity-line/` is editing `main.ts`
           **other builders**: no other file builds a whole `MainServices`. `src/main/plugins/main-api.test.ts` casts partial objects (`as MainServices`, `as unknown as MainServices`), and `src/plugins/chat/main/start.ts` and its test take a `Pick<MainServices, …>` without `timers`; each compiles unchanged. A builder the compiler names gets `timers` added
           **no test**: the adapter is composition-root wiring over Node's own timers, and the compiler checks every `MainServices` builder. Task 05's poller tests prove the seam with a fake `Timers`
Done when: compiles; `npm run lint` passes; `grep -n 'timers: Timers' src/contracts/plugin.ts` shows two members, `PageServices`' and `MainServices`'; the test gate picks nothing (no test file changes; record that reason)
Commit:    one commit for the group

## Proof
