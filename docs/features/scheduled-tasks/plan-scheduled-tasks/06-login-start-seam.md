# 06 — Login-start seam

Status: not started
Type: Task
Wave: 2 · Depends on: 03
Plan: [plan.md](plan.md)

This task completes the login-start platform seam (AGENTS.md § Intent, macOS and Windows): a no-op adapter for every
run that does not start the host at login, a fake for tests, and `MainServices.loginStart`, over the contract types
task 03 wrote. Every app start gets the no-op adapter here. Task 18 adds the two macOS adapters and the pick. It
depends on 03 for `src/contracts/login-start.ts`; it reads nothing from 01's result.

Files:     modify `src/contracts/login-start.ts` (only where the seam needs a change to 03's types; else unchanged) ·
           create `src/shared/fake-login-start.ts` · create
           `src/main/login-start/no-login-start.ts` · test `src/shared/fake-login-start.test.ts` (create) · test
           `src/main/login-start/no-login-start.test.ts` (create) · modify `src/contracts/plugin.ts` · modify
           `src/shared/plugin-part-harness.test-support.ts` · modify `src/main/main.ts` · modify
           `scripts/check-layers.mts` · check `src/main/plugins/main-api.ts`
Consumes:  `LoginStartState`, `LoginStartStatus`, `LoginStart` in `src/contracts/login-start.ts` ← 03 (plan.md
           § Shared names and shapes › Login start, word for word) ·
           `MainServices` in `src/contracts/plugin.ts` (tree, line 1073) · `MainApiServices` in
           `src/main/plugins/main-api.ts` (tree) · the `services` block of `createMainWorld` in
           `src/shared/plugin-part-harness.test-support.ts` (tree, around line 1000) · the services literal
           `startMainParts` gets in `createWindow` in `src/main/main.ts` (tree, around line 1169) · `CORE_LAYERS`
           and its `'src/main/main.ts'` entry in `scripts/check-layers.mts` (tree)
Produces:  in `src/contracts/plugin.ts`: `MainServices.loginStart: LoginStart`
           in `src/main/login-start/no-login-start.ts`: `export function createNoLoginStart(): LoginStart`
           in `src/shared/fake-login-start.ts`:
           `export interface FakeLoginStart extends LoginStart { readonly calls: boolean[]; answer(status: LoginStartStatus): void }`
           `export function createFakeLoginStart(): FakeLoginStart`

## Changes

- `login-start.ts`: task 03 wrote the three types with the comments plan.md gives them. Check them against plan.md;
  change the file only where this seam needs it. `set` never rejects: a failure resolves to `off` with the reason in
  `detail`.
- `createNoLoginStart()`: `set` resolves to `{ state: 'unsupported', detail: null }` for `true` and `false`, and
  changes nothing.
- `createFakeLoginStart()`: `set(on)` pushes `on` to `calls`. It resolves to the status the last `answer` call gave.
  Before any `answer`, it resolves to `{ state: on ? 'on' : 'off', detail: null }`.
- `MainServices`: add `loginStart: LoginStart` after `sessionHost`. Add one sentence to the comment above the
  interface: `loginStart` starts the session host when the user logs in, `unsupported` where the app does not
  (`src/contracts/login-start.ts`).
- `main-api.ts`: `createMainApi` spreads `deps.services` into each part's services, so `loginStart` reaches every
  part with no edit. `MainApiServices` is `Omit<MainServices, 'selfTest' | 'log'> & { log }`, so it requires
  `loginStart` from `main.ts`. Confirm both by the typecheck; edit the file only if the typecheck shows a gap.
- Part harness: the `services` block gets `loginStart: createFakeLoginStart()` before `...replaced`, so a test
  passes its own fake through `options.services.loginStart` and reads `calls` from it.
- `main.ts`: the services literal in `createWindow` gets `loginStart: createNoLoginStart()`. Every run mode gets it
  in this task.
- `check-layers.mts`: add `'src/main/login-start': { layers: ['src/contracts', 'src/shared'], packages: [] }` to
  `CORE_LAYERS`, with a comment: the login-start adapters; files through `Files`, programs through `ProcessRunner`,
  Electron's `app` handed in by `main.ts` as a structural type, no `node:` or `electron` import. Add `'src/main/login-start'` to the `layers` of the `'src/main/main.ts'` entry.

Decisions: the seam lives in `src/contracts` with adapters in `src/main/login-start/` and the pick in `main.ts`
           (settled design, round 6; AGENTS.md § Intent) · the no-op adapter answers `unsupported`, which
           Schedules mode shows for Windows, Linux, the dev app, the self-test and drive runs (plan.md § Shared
           names) · the harness default is a fake, not `notFaked`, so a part that calls `loginStart.set` at start
           (task 17) runs in every part test without each test passing one
GIVEN a part started through `startMainPart` with no `loginStart` option WHEN the part calls
`services.loginStart.set(true)` THEN it resolves to `{ state: 'on', detail: null }` and the harness fake records `true`
GIVEN the app in any run mode WHEN a main part calls `services.loginStart.set(true)` THEN it resolves to
`{ state: 'unsupported', detail: null }`
Tests:     `src/shared/fake-login-start.test.ts`: one `it.each` over calls — `set(true)` and `set(false)` before any
           `answer` resolve `on` and `off` with `detail` null; after `answer({ state: 'needsApproval', detail: 'x' })`
           both resolve that status; `calls` holds every `on` in call order. Break: a default that ignores `on`, which
           tasks 17 and 19 read through the harness. `src/main/login-start/no-login-start.test.ts`: `set(true)` and
           `set(false)` both resolve `{ state: 'unsupported', detail: null }`. The user checks the picked adapter (task 21 § The user's checks).
Done when: `npm run typecheck`, `npm run lint` and `npm test` exit 0
Commit:    one commit for the group

## Proof

