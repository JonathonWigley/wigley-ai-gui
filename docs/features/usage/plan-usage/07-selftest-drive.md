# 07 — Self-test and drive actions

Status: done
Type: Batch
Wave: 5 · Depends on: 06
Plan: [plan.md](plan.md)

Files:     create `src/plugins/usage/main/usage-fixture.ts` · create `src/plugins/usage/main/drive-actions.ts` · test `src/plugins/usage/main/drive-actions.test.ts` · create `src/plugins/usage/main/selftest-script.ts` · test `src/plugins/usage/main/selftest-script.test.ts` · modify `src/plugins/usage/main/start.ts` · test `src/plugins/usage/main/start.test.ts`
Consumes:  `UsageSnapshot`, `ProfilePlan`, `SessionUsage` in `src/plugins/usage/contract.ts` ← 05
           `UsageState`, `EMPTY_USAGE_STATE` in `src/plugins/usage/main/usage-store.ts` ← 05
           `PlanPoller.pollNow(): Promise<void>` and `PlanPoller.dispose()` in `src/plugins/usage/main/plan-poller.ts` ← 05
           `usageMainPart` in `src/plugins/usage/main/start.ts` ← 05 (with 06's layout registration)
           the page log lines `[usage] status line …`, `[usage] details shown: …`, `[usage] details hidden` and the texts `statusLineText` / `detailsStatesText` build, in `src/plugins/usage/page/` ← 06
           `FakeAgentHarness.failNextPlanUsage(message: string): void` and `fakePlanUsage(at)` in `src/shared/fake-agent-harness.ts` ← 03 (the fake's `planUsage` resolves `fakePlanUsage(clock.now())` for every profile)
           `isFakeAgentHarness` in `src/shared/fake-agent-harness.ts`; `SessionsMainExports.connect`, `activate`, `selectedSessionId` in `src/plugins/sessions/contract.ts`; `SelfTestScript`, `SelfTestGroup`, `DriveHost`, `MainServices.selfTest`, `MainApi.drive` in `src/contracts/plugin.ts`; `argsObject`, `optionalString` in `src/shared/drive-args.ts` (in the tree)
Produces:  `export type UsageFixtureVariant = 'fresh' | 'stale' | 'error'` and `export function usageFixture(variant: UsageFixtureVariant, now: number, sessionId: string | null): UsageSnapshot` in `src/plugins/usage/main/usage-fixture.ts`
           `export interface UsageDriveDeps` and `export function addDriveActions(drive: DriveHost, deps: UsageDriveDeps): Disposable` in `src/plugins/usage/main/drive-actions.ts`
           `export interface UsageSelfTestDeps` and `export function usageSelfTestScript(deps: UsageSelfTestDeps): SelfTestScript` in `src/plugins/usage/main/selftest-script.ts`
           drive actions `usage.seed`, `usage.snapshot`, `usage.pollNow`, `usage.failNextPoll`
Decisions: **why the self-test seeds**: its steps wait for exact page lines, and the line the start poll draws is logged before the script's first mark. So `open` seeds a fixed snapshot and the steps wait for the lines it draws. The poll path over the fake harness is still proved: `open` records which plans held no usage before the seed, and `problems` fails on any (the fake resolves every profile's poll at start)
           **seeding** (`start.ts`): a `seed(snapshot)` function replaces the state with `{ snapshot, held: [] }`, disposes the poller for the rest of the run and sends `changed`. Live `chat.planUsage` and `chat.agentEvent` still fold after it. After a seed, or with no harness, the `pollNow` dep rejects with `usage.seed stopped the poller for this run` or `no agent harness "claude"`. `start.ts` hands `usageSelfTestScript` to `services.selfTest?.run(…)` and, when `api.drive` is not null, calls `addDriveActions`, disposing them in `dispose`
           **the fixture** (`usageFixture`; every time is relative to `now`, so countdowns read the same at any run). `fresh`:
           · plan `work`, `profileDir: '~/.claude'`, `isDefault: true`: rows `{ kind: 'session', group: 'session', label: '5h', percent: 42, resetsAt: now + 8_070_000, severity: 'normal', isActive: true }`, `{ kind: 'weekly_all', group: 'weekly', label: 'Week', percent: 61, resetsAt: now + 274_000_000, severity: 'warning', isActive: true }`, `{ kind: 'weekly_scoped', group: 'weekly', label: 'Fable', percent: 88, resetsAt: now + 274_000_000, severity: 'critical', isActive: false }`; `extraUsage: { enabled: true, usedMinor: 1234, limitMinor: 5000, currency: 'USD' }`; `usage.at` and `lastGoodAt` `now − 180_000`; `error: null`, `stale: false`
           · plan `personal`, `profileDir: '~/.claude-personal'`, `isDefault: false`: rows `5h` 7 % `normal` resets `now + 14_430_000`, `Week` 12 % `normal` resets `now + 518_430_000` (kinds, groups and `isActive` as work's); `extraUsage: { enabled: false, usedMinor: null, limitMinor: null, currency: null }`; times, error and stale as work's
           · when `sessionId` is not null, one session `{ sessionId, profileDir: '~/.claude', usage: { type: 'usage', agentId: 'main', at: now, contextTokens: 180_000, contextWindow: 1_000_000, autocompact: { configured: 300_000, reported: 967_000 }, cacheExpiresAt: now + 2_550_000, spendUsd: 1.234 } }`
           `stale` changes work only: `usage.at` and `lastGoodAt` `now − 1_500_000`, `error: 'claude exited with code 1'`, `stale: true`. `error` changes work only: `usage: null`, `lastGoodAt: null`, `error: 'claude exited with code 1'`, `stale: true`. The values differ from `fakePlanUsage`'s (5h 35, Week 97, Fable 0), so a line drawn from the fake never passes for the seed
           **lines the fixture draws** (06's formats; the self-test waits for the first three):
           · fresh status line: `[usage] status line context 180k/300k, cache 42m, spend $1.23 | work: 5h 42%, Week 61%, Fable 88%`
           · fresh details: `[usage] details shown: work fresh, personal fresh`; closing: `[usage] details hidden`
           · stale status line: `[usage] status line context 180k/300k, cache 42m, spend $1.23 | work: 5h 42%, Week 61%, Fable 88% (stale)`; details `work stale, personal fresh`
           · error status line: `[usage] status line context 180k/300k, cache 42m, spend $1.23 | work: plan unavailable`; details `work error, personal fresh`
           **drive actions** (`drive-actions.ts`, notes' shape, each `run` reading its args with `argsObject`):
           ```ts
           export interface UsageDriveDeps {
             clock: Clock;
             selectedSessionId(): string | null;
             snapshot(): UsageSnapshot;
             seed(snapshot: UsageSnapshot): void;
             pollNow(): Promise<void>;
             harnesses: readonly AgentHarness[];
           }
           ```
           · `seed` — description `Replaces plan and session usage with a fixed snapshot and stops the poller for the run: fresh, stale (work's poll failed after a good one) or error (work's first poll failed). The session's usage goes on sessionId, else the selected session, on work.`; args `{ "variant"?: "fresh" | "stale" | "error", "sessionId"?: string }`; `variant` defaults to `fresh`, and any other value throws `variant must be fresh, stale or error`; `sessionId` defaults to `selectedSessionId()`, and null seeds no session; returns the seeded snapshot
           · `snapshot` — `Returns the usage snapshot the page draws.`; args `{}`
           · `pollNow` — `Reads every profile's plan usage now and returns the snapshot once the reads settle.`; args `{}`
           · `failNextPoll` — `Makes the fake harness's next plan usage read fail with message, so the next poll marks its profile stale. Fake harness only.`; args `{ "message"?: string }`, default `fake poll failed`; throws `usage.failNextPoll needs the fake harness` when no harness in `harnesses` passes `isFakeAgentHarness`; returns `{}`
           **self-test script** (`selftest-script.ts`, primer's shape):
           ```ts
           export interface UsageSelfTestDeps {
             sessions: Pick<SessionsMainExports, 'connect' | 'activate'>;
             clock: Clock;
             snapshot(): UsageSnapshot;
             seed(snapshot: UsageSnapshot): void;
           }
           ```
           `open(run)` ends the session the run before connected, connects `{ sessionId: 'usage-selftest-<run>', projectDir: 'usage-selftest', harness: 'claude', deadlineSeconds: null }`, activates its row (so the line shows that session whatever an earlier script left selected), records the names of the plans whose `usage` is null in `snapshot()`, then seeds `usageFixture('fresh', clock.now(), connected.session.id)`. `connect` gives the session its own id (`randomHex()`), not the host id `usage-selftest-<run>`, and the page shows that id (`selectedSessionId()`): `connected.session.id` is the id `activate`, the seed and `result` use. `shownLine` is the fresh status line. `result` resolves at once to `{ unreadPlans, snapshot: <the seeded snapshot>, sessionId: connected.session.id }`. `problems`: `no plan was read before the seed` when the snapshot before the seed held no plan, `plan <name> was not read before the seed` per unread plan, and `session <result.sessionId> has no usage` when the seeded snapshot lacks the session. `pageBinds: []`, `settings: {}`, `scrollsItself: []`
           **groups** (the keys are the leader bind, `Space v u`):
           · `details` — why `Space v u opens the usage details in the right bar beside the content and closes them again, and the status line and the bar each fit the minimum width.` Steps: `{ keys: [' ', 'v', 'u'], expect: '[usage] details shown: work fresh, personal fresh', screenshot: 'details', checksFit: true }`, `{ keys: [' ', 'v', 'u'], expect: '[usage] details hidden', screenshot: 'status-line', checksFit: true }`
           · `narrow` — why `In a narrow window the status line wraps between its groups and the right bar leaves the content its least width.` Steps: `{ width: 520, keys: [' ', 'v', 'u'], expect: '[usage] details shown: work fresh, personal fresh', screenshot: 'details-narrow' }`, `{ keys: [' ', 'v', 'u'], expect: '[usage] details hidden', screenshot: 'status-line-narrow', width: 'start' }`
           The script ends with the details closed, so `uiState` holds no open bar for the next script or run
GIVEN the self-test's fake harness polled both default profiles at start WHEN the usage script opens THEN the session `connect` returned for host id `usage-selftest-<run>` is selected, the page logs the fresh status line, and `problems` returns `[]`
GIVEN a drive run on the fake harness WHEN `usage.failNextPoll` then `usage.pollNow` run THEN the returned snapshot's `work` plan keeps its usage with `stale: true` and `error: 'fake poll failed'`, and `personal` is fresh
Tests:     `drive-actions.test.ts` (a recording fake `DriveHost`, a fixed clock, recording `seed`):
           · `seed_Args_<case>` table: no args → variant `fresh` on the selected session; `sessionId` given → that id; selected none → no session in the snapshot; `variant: 'stale'` → work `stale: true` with usage kept; `variant: 'error'` → work `usage: null`; `variant: 'odd'` throws `variant must be fresh, stale or error`
           · `failNextPoll_<case>` table: a fake harness → its next `planUsage` rejects with the given message, and with `fake poll failed` when none is given; no fake harness → throws `usage.failNextPoll needs the fake harness`
           · `pollNow_ReturnsTheSnapshotAfterThePollSettles`
           `selftest-script.test.ts`:
           · `open_ConnectsActivatesAndSeedsTheRunSession` — the fake `connect` returns an id distinct from the host id (host `usage-selftest-2`, session id `s-2`); `open` activates `s-2` and seeds with `s-2`, so a seed under the host id fails the test; a second open ends the first session
           · `problems_<case>` table: every plan read and the session seeded → `[]`; a plan with null usage before the seed → `plan work was not read before the seed`; no plan before the seed → `no plan was read before the seed`; the seeded snapshot without the session → `session s-1 has no usage` (the result's `sessionId` is `s-1`, the id `connect` returned)
           `start.test.ts`: add `usageMainPart_Seed_StopsThePollerAndSendsTheFixture` — through the drive host fake: `usage.seed` sends one `changed` with the fixture, the fake timers hold no armed run, and `usage.pollNow` rejects `usage.seed stopped the poller for this run`
Done when: compiles; `npm run lint` passes; the test gate runs the tests above. `npm run selftest` passes with the `usage` groups and their four screenshots (`usage-details`, `usage-status-line`, `usage-details-narrow`, `usage-status-line-narrow`), and every other plugin's `checksFit` steps still pass with the line in the status bar; the screenshots are read in `09-final-verification.md`
Commit:    one commit for the group

## Proof

Commit 145aa74 + b406bfb · proof: diff read: fixture, drive actions, self-test script present; typecheck clean; 19 unit tests pass; first selftest failed the details group's 420px fit (right bar beside left main ~10px), fixed by the lead's over-layout ruling in b406bfb; npm run selftest then passed in full; four usage screenshots read · concerns: failNextPoll fails whichever profile polls first (chat order), not necessarily work; notes toasts cover the lower right of usage screenshots; at 200px the Context/Autocompact labels ellipsize to Co…/Auto…; 09 D3–D5 and 01's narrow decision still state beside-at-every-width
