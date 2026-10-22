# 01 — Run modes and the drive host contract

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     create `src/main/run-mode.ts` · test `src/main/run-mode.test.ts` · modify `src/contracts/plugin.ts` · modify `src/main/plugins/main-api.ts` · test `src/main/plugins/main-api.test.ts` · modify `src/main/main.ts` · modify `src/plugins/sessions/main/start.ts` · modify `src/plugins/docs/main/start.ts` · modify `src/plugins/forms/main/start.ts` · modify `docs/features/followups.md`
Consumes:  nothing
Produces:  `export type RunMode = 'live' | 'selfTest' | 'drive';` in `src/contracts/plugin.ts`
           `export interface DriveAction { description: string; args: string; run(args: unknown): Promise<unknown>; }` in `src/contracts/plugin.ts`
           `export interface DriveHost { add(name: string, action: DriveAction): Disposable; }` in `src/contracts/plugin.ts`
           `runMode: RunMode` on `MainServices`, `drive: DriveHost | null` on `MainApi`, in `src/contracts/plugin.ts`
           `driveFor(pluginId: string): DriveHost | null` on `MainApiDeps` in `src/main/plugins/main-api.ts`
           `export function runModeOf(env: NodeJS.ProcessEnv): RunMode` in `src/main/run-mode.ts`
Decisions: one service set per run mode, landing the follow-up (design review) · plugins read `services.runMode`, not `selfTest !== null` (design review) · `drive` is a separate host from `selfTest` (round 2)

## What changes

- `runModeOf`: `PROOF_SELFTEST` non-empty → `'selfTest'`; `WIGLEY_DRIVE_DIR` non-empty → `'drive'`; both → throws `Set PROOF_SELFTEST or WIGLEY_DRIVE_DIR, not both`; neither → `'live'`.
- `DriveHost.add` qualifies `name` by the plugin id as commands are (`openRound` in `forms` → `forms.openRound`); the comment on `DriveHost` states that, that the returned `Disposable` removes the action, and that `MainApi.drive` is null outside a drive run.
- `createMainApi` sets `drive: deps.driveFor(manifest.id)` and `services.runMode` from `deps.services`.
- `main.ts`: `const isSelfTest = Boolean(process.env.PROOF_SELFTEST)` becomes `const runMode = runModeOf(process.env)`. Each `isSelfTest ? A : B` service choice (files' `trashItem`, `alerts`, `agentHarnesses`, `window`, `openExternal`) moves into one function per mode that returns the service set (`liveServices(...)`, `selfTestServices(...)`); `'drive'` gets the self-test's set here, and task 09 gives it its own. The other `isSelfTest` reads (temp home, accessory policy, single-instance lock, offscreen, global shortcuts, close-hides) read `runMode !== 'live'` where a drive run behaves as the self-test does (all of these), and `runMode === 'selfTest'` where only the self-test applies (`startSelfTest`). `driveFor` is `() => null` until task 09. Two reads the list above leaves out: `shouldReadLoginShellPath` gets `isSelfTest: runMode !== 'live'`, so a drive run keeps the CLI's PATH (where ffmpeg is); `failStart` calls `failSelfTest` when `runMode === 'selfTest'` and keeps today's dialog otherwise, until task 09 gives drive its own.
- `sessions/main/start.ts`: the relay opens unless `runMode === 'selfTest'` (a drive run opens it in its temp home).
- `docs/main/start.ts`: `writeDocsFixture` runs when `runMode !== 'live'`, so Docs works at a drive run's start.
- `forms/main/start.ts`: the self-test layout fixture is written when `runMode === 'selfTest'`.
- `followups.md`: remove the entry "The self-test picks one service set (`selfTestServices` or `liveServices`) in `main.ts` rather than an `isSelfTest` ternary per service."

GIVEN env `{ PROOF_SELFTEST: '1', WIGLEY_DRIVE_DIR: '/x' }` WHEN `runModeOf` runs THEN it throws naming both variables
GIVEN `driveFor` returns a host for `forms` WHEN `createMainApi(formsManifest, deps)` runs THEN `api.drive` is that host

Tests:     `run-mode.test.ts`: `'selfTest' when PROOF_SELFTEST is set`, `'drive' when WIGLEY_DRIVE_DIR is set`, `'live' when neither is set`, `throws when both are set`; `main-api.test.ts`: `hands each plugin its own drive host`, beside the existing self-test host test
Done when: typecheck and lint pass; `npm run selftest` still passes (the self-test service set is unchanged)
Commit:    one commit for the group

## Proof
