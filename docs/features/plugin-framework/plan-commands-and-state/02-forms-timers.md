# 02 — Forms takes the timers service

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:

- modify `src/shared/agent-forms/form-service.ts`
- modify `src/shared/tracked-timers.ts`
- modify `src/plugins/forms/main/start.ts`
- modify `src/plugins/primer/main/start.ts`
- create `src/shared/agent-forms/global-timers.test-support.ts`
- test `src/shared/agent-forms/form-service.test.ts`
- test `src/shared/tracked-timers.test.ts`
- test `src/plugins/forms/main/round-type.test.ts`
- test `src/plugins/primer/main/primer-type.test.ts`

Consumes: `Timers` in `src/contracts/ambient.ts` and `MainServices.timers`, both in the tree.

Produces:

- `AgentFormServiceDeps<Form, Body, Payload>` gains `timers: Timers` in `src/shared/agent-forms/form-service.ts`.
- `MAX_TIMER_MS = 2 ** 31 - 1`, a local const in `src/shared/tracked-timers.ts`.
- `globalTimers: Timers` in `src/shared/agent-forms/global-timers.test-support.ts`. It is `trackedTimers` over the global `setTimeout` and `clearTimeout`, so `vi.useFakeTimers` drives it and a test reaches the clamp as a plugin does. Its numeric handle comes from `setTimeout(run, ms)[Symbol.toPrimitive]()`, as `src/main/main.ts:315` does.

Decisions:

- **The clamp lands in `trackedTimers.set`.** It is the adapter every plugin in both processes receives. It passes `Math.min(ms, MAX_TIMER_MS)` to the inner timers. The `setTimeout` limit comment moves with the const.
- **The composition roots' adapters do not change.** `src/main/main.ts`, `src/renderer/renderer.ts` and `src/session-host/session-host.ts` keep theirs. Their direct users pass short constants. Task 01 also edits the first two files in this wave.
- **`form-service.ts` loses `MAX_TIMER_SECONDS` and its check in `deadlineSeconds`.** A host deadline stays valid when it is finite and above 0. A deadline past the limit now waits the longest delay a timer takes, 2147483647 ms, about 24.8 days. Today it falls back to the default. The follow-up asks for this move, so the change is accepted.
- **A `deadlineSeconds` setting past the limit also waits the longest delay.** Today it fires at once.
- **`SessionContext` holds `timers`.** `waitForEndOrDeadline` and `openFormWhenFree` set and clear through it. `form-service.ts` holds no global timer call after this task.
- **Each `createAgentFormService` call passes `timers: services.timers`.** There are four calls in the plugins: two in `forms/main/start.ts` (lines 86 and 93) and two in `primer/main/start.ts` (lines 100 and 107).
- **Stopping the plugin now clears its deadline timers,** since `services.timers` is the tracked view. A call that still waits ends when its session ends, because `endSession` wakes the waiters through `closeOpenForm`. Only quit stops a plugin today, and the process exit ends the call. Add no code for this case.

GIVEN a host deadline of 300 s WHEN 300 s pass on the timers THEN the call returns its draft.

GIVEN a host deadline of 2_147_484 s WHEN the default deadline passes THEN the call has not settled. WHEN 2147483647 ms have passed THEN the call returns its draft.

GIVEN a deadline of 0 or -5 WHEN the default deadline passes THEN the call returns its draft.

GIVEN a call that settles before its deadline WHEN it settles THEN no timer stays pending.

GIVEN `trackedTimers` WHEN `set` runs with 2 ** 31 ms THEN the inner timers receive 2147483647 ms. WHEN `set` runs with 1000 ms THEN the inner timers receive 1000 ms.

Tests:

- `src/shared/tracked-timers.test.ts`, add `it('caps a delay past the 32-bit limit at the longest delay a timer takes')`. The file's `fakeTimers` stores only the run today, so it gains a `delays: number[]` that `set(run, ms)` pushes to, and it returns `delays`. Assert the two delays above from `delays`. Catches: a long deadline firing at once, which is the bug the clamp exists for.
- `src/shared/agent-forms/form-service.test.ts`, the `it.each([0, -5, 2_147_484])` block at line 279: remove the row `2_147_484` and its comment. Add `it('waits the longest timer delay for a host deadline past the 32-bit limit')`, with the second behaviour above. Catches: the host's long deadline falling back to the default, or firing at once.
- `src/shared/agent-forms/form-service.test.ts`, add `it('runs its deadline through the timers it is given')`. Pass a hand-driven `Timers` to `createAgentFormService`. Assert one `set` with `DEFAULT_DEADLINE_SECONDS * 1000`. Fire it and assert the call returns its draft. Do not advance the fake clock. Catches: a global `setTimeout` call coming back, which `vi.useFakeTimers` alone cannot show.
- `src/shared/agent-forms/form-service.test.ts`, add `it('leaves no timer pending once a call settles')`: submit a form, then assert `vi.getTimerCount()` is 0. Catches: a clear with the wrong handle after the move to numeric handles.
- `form-service.test.ts` lines 75 and 1380, `round-type.test.ts` line 120 and `primer-type.test.ts` line 38: pass `timers: globalTimers`. These suites keep `vi.useFakeTimers`.

Runtime checks collect in [Final verification](16-final-verification.md).

Done when:

- `npm run typecheck` and `npm run lint` pass.
- `grep -n 'setTimeout\|clearTimeout\|MAX_TIMER' src/shared/agent-forms/form-service.ts` prints nothing.
- `grep -n 'MAX_TIMER_MS' src/shared/tracked-timers.ts` prints the const and its use.
- The test gate runs the tests above.

Commit: one commit for the group.

## Proof

