# 01 — App writes its process id to the endpoint file

Status: done
Type: Task
Rung: hard · adds the `pid` field of the endpoint contract that task 02 reads
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Repo: wigley-ai-gui. Work in a worktree per `~/wigley-agents/WigleyRepos.md` § Landing.

Files:     modify `src/contracts/platform.ts` · modify `src/shared/platform.ts` · modify `src/main/main.ts`
           · modify `src/plugins/sessions/contract.ts` · modify `src/plugins/sessions/main/start.ts`
           · modify `src/shared/platform.test-support.ts` · test `src/shared/platform.test.ts`
           · test `src/plugins/sessions/main/start.test.ts` · test `src/plugins/sessions/main/relay/endpoint.test.ts`
Consumes:  `platformFor(os, inputs)` and `launchCommand(...)` in `src/shared/platform.ts` (tree)
Produces:  `readonly pid: number` on `PlatformRelay` in `src/contracts/platform.ts`
           `pid: number` on `PlatformInputs` in `src/shared/platform.ts`
           `pid: number` on `RelayEndpoint` in `src/plugins/sessions/contract.ts`
           the key `pid` in every `endpoint.json` the app writes
Decisions:
- `PlatformRelay.pid` is the app's main process id. Its comment: the process a restart asks to quit.
- `platformRecord` copies `inputs.pid` into `relay.pid`, for every OS.
- `main.ts` passes `pid: process.pid` in the `platformFor` call at line 459. This is the only read of `process.pid`.
- `openRelay` in `start.ts` sets `pid: api.services.platform.relay.pid` on the endpoint, in every run mode, a
  drive run included. A drive run's own `quit` stays its way to stop.
- `fakePlatform` in `platform.test-support.ts` passes a fixed `pid` (4242).
- `RelayEndpoint.pid` is required: the app always knows its process id.
GIVEN `platformFor(os, inputs)` for each OS WHEN `inputs.pid` is 4242 THEN `relay.pid` is 4242
GIVEN the sessions plugin started WHEN it writes `endpoint.json` THEN the file holds `pid` equal to
  `platform.relay.pid`
Tests:
- `platformFor_Inputs_LaunchIsLaunchCommand` in `src/shared/platform.test.ts`: add `pid: 4242` to `INPUTS` and
  assert `relay.pid` is 4242 in each OS row. Rename the test to `platformFor_Inputs_RelayCarriesLaunchAndPid`.
- The `start.test.ts` test that reads `endpoint.json` (it asserts `toMatchObject({ launch: platform.relay.launch })`):
  extend the assertion to `{ launch: platform.relay.launch, pid: 4242 }`, the literal `fakePlatform` passes, so a
  wrong source for `pid` fails. No drive-run row: `pid` is set outside the run-mode branch in `openRelay`, so one
  path writes it in every mode.
- `endpoint.test.ts`: add `pid` to its `RelayEndpoint` literal at line 55, so the round-trip test writes it.
Done when: `npm run typecheck` (or the compile `npm test` runs) passes; the test gate runs the tests above.
Commit:    one commit for the group.

## Proof

Commit 1d8527bb · proof: diff read: PlatformRelay.pid, PlatformInputs.pid, RelayEndpoint.pid present and written in openRelay; npm run typecheck passes · concerns: none
