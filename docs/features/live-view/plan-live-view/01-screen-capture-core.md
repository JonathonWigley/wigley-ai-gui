# 01 — ScreenCapture core service

Status: done
Type: Task
Rung: deep · crosses Electron, the OS permission model and the composition root's mode wiring, and adds the seam 04, 05 and 06 consume
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Repo: wigley-ai-gui, worktree `/Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-gui-live-view`.

Files:
- create `src/contracts/screen-capture.ts`
- create `src/main/screen-capture/screen-capture.ts` · test `src/main/screen-capture/screen-capture.test.ts`
- create `src/main/screen-capture/unavailable-screen-capture.ts`
- create `src/main/screen-capture/electron-capture.ts`
- create `src/shared/fake-screen-capture.ts` · test `src/shared/fake-screen-capture.test.ts`
- modify `src/contracts/plugin.ts` (`MainServices`, its doc comment)
- modify `src/main/main.ts` (`ModeServices.forWindow`, `liveServices`, `offscreenRunServices` and its callers, a `screenCaptureFor` pick)
- modify `scripts/check-layers.mts` (`CORE_LAYERS`, the `src/main/main.ts` entry, test entries)
- modify `src/shared/plugin-part-harness.test-support.ts` (default services)
- move `src/main/system-stats/required-stdout.ts` to `src/main/processes/required-stdout.ts`, unchanged, and modify
  its two importers, `mac-system-stats.ts` and `windows-system-stats.ts`

Consumes: nothing from other tasks. Pattern to follow: the `systemStats` service end to end:
- `src/contracts/system-stats.ts`
- `src/main/system-stats/` (with `unavailable-system-stats.ts`)
- `src/shared/fake-system-stats.ts`
- `systemStatsFor` in `src/main/main.ts` (~line 302)
- `systemStats` in `MainServices` (`src/contracts/plugin.ts` ~line 1077)
- `notFaked<SystemStats>('systemStats')` in the part harness (~line 1021)
- `'src/main/system-stats'` in `CORE_LAYERS` (`scripts/check-layers.mts` ~line 553) and in the `src/main/main.ts` entry (~line 644)

Produces (exact shapes are in plan.md § File Structure):
- `src/contracts/screen-capture.ts`: `ScreenRect`, `CaptureWindow`, `WindowList`, `ScreenCapture`
- `src/main/screen-capture/screen-capture.ts`: `OsWindow`, `OsWindowLister`, `ScreenCaptureDeps`, `createScreenCapture(deps: ScreenCaptureDeps): ScreenCapture`
- `src/main/screen-capture/unavailable-screen-capture.ts`: `createUnavailableScreenCapture(os: OsName): ScreenCapture`
- `src/main/screen-capture/electron-capture.ts`: `electronCaptureSources(): Promise<readonly { id: string }[]>`, `macScreenAccess(): 'granted' | 'blocked'`, `openMacScreenSettings(): Promise<void>`
- `src/shared/fake-screen-capture.ts`: `FAKE_EDITOR_PROCESS_ID`, `FAKE_GAME_RECT`, `createFakeScreenCapture(options?)`
- `MainServices.screenCapture: ScreenCapture` in `src/contracts/plugin.ts`

Decisions:
- `createScreenCapture.listWindows()`:
  - When `deps.access()` is `'blocked'`, it returns `{ access: 'blocked' }` and calls neither `windows.list()` nor
    `sources()`.
  - Otherwise it calls both. It keeps each OS window that has a source whose id starts with `window:<number>:`. It
    keeps the windows' order (front to back), and it maps each to a `CaptureWindow` with that source's id.
  - A window with no source is left out.
  - When `access()` is `'granted'`, `deps.blockedWhenNoSources` is true, and `sources()` returns no `window:` source
    at all, it returns `{ access: 'blocked' }`. On macOS, an undetermined grant shows the OS prompt on the first
    `getSources` call, and that call returns no windows. macOS passes `true`.
  - Windows passes `false`. Windows has no capture permission, so an empty source list there gives
    `{ access: 'granted', windows: [] }`, and the tool replies with its no-window error.
  - When `windows.list()` or `sources()` rejects, `listWindows` rejects with the same error. The tool replies with
    its message.
- `openAccessSettings()` calls `deps.openSettings()`.
- `electron-capture.ts`:
  - `electronCaptureSources` is `desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } })`,
    mapped to `{ id }`.
  - `macScreenAccess` maps `systemPreferences.getMediaAccessStatus('screen')`: `'denied'` and `'restricted'` give
    `'blocked'`, every other value gives `'granted'`. An undetermined grant counts as granted, so the OS prompt can show.
  - `openMacScreenSettings` is `shell.openExternal(MAC_SCREEN_SETTINGS_URL)`.
- The Windows wiring passes `access: () => 'granted'` and `blockedWhenNoSources: false`, because Windows has no
  capture permission. Its
  `openSettings` rejects with `Windows has no Screen Recording setting`.
- `screenCaptureFor(osName, runner)` in `main.ts` is a `switch` like `systemStatsFor`:
  - `'linux'` (default) returns `createUnavailableScreenCapture(osName)`. Its `listWindows` and `openAccessSettings`
    reject with `Screen capture is not available on ${os}`.
  - Task 04 adds the `'macos'` and `'windows'` cases with their listers. Until then, this task makes those two cases
    return `createUnavailableScreenCapture(osName)`, so the build stays green between waves.
- Mode wiring:
  - Add `'screenCapture'` to `ModeServices.forWindow`'s `Pick`.
  - `liveServices()` uses `screenCaptureFor(platform.os, processes)`.
  - `offscreenRunServices` takes a `screenCapture: () => ScreenCapture` beside its `systemStats` parameter. Self-test
    and drive both pass `() => createFakeScreenCapture()`.
- The fake:
  - It lists two windows of `FAKE_EDITOR_PROCESS_ID` (4242), front to back:
    1. a floating Game View window, `sourceId: 'sample:405x760'`, title `Game`, bounds `{ x: 1500, y: 120, width: 405, height: 760 }`
    2. the main editor window, `sourceId: 'sample:1440x900'`, title `[selftest-unity] SampleScene`, bounds `{ x: 0, y: 25, width: 1440, height: 900 }`
  - It also lists a third window of another pid (`sample:800x600`, title `Other`), so the pick's process filter has
    something to drop.
  - `FAKE_GAME_RECT` is `[500, 120, 360, 640]`, which lies inside the main editor window and not inside the floating
    one.
  - `options.access: 'blocked'` makes `listWindows` return `{ access: 'blocked' }`.
  - `openAccessSettings` resolves.
- Layers:
  - `'src/main/screen-capture': { layers: ['src/contracts', 'src/main/processes'], packages: ['electron'] }`: the
    alerts and images shape, plus `src/main/processes` for `requiredStdout`, which 04's listers use.
  - Add `'src/main/processes'` to the `'src/main/system-stats'` entry's layers, for the moved `requiredStdout`. The
    move keeps one copy of its timeout and exit-code rules, and neither adapter folder imports the other.
  - Add `'src/main/screen-capture'` to the `src/main/main.ts` entry's layers.
  - Give `screen-capture.test.ts` its own entry when it imports `src/shared` fakes, as `system-stats/mac-system-stats.test.ts` does.
- Part harness: add `screenCapture: notFaked<ScreenCapture>('screenCapture')` to the default services.
- `MainServices` doc comment: add one sentence for `screenCapture` beside the system stats sentence.

Pinned values:
- `MAC_SCREEN_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'`
- source id match: prefix `window:<number>:`
- unavailable message: `Screen capture is not available on ${os}`

GIVEN access blocked WHEN listWindows runs THEN it returns `{ access: 'blocked' }` and lists nothing
GIVEN three OS windows and sources for two of them WHEN listWindows runs THEN it returns those two, in the OS order, each with its source id
GIVEN access granted, `blockedWhenNoSources` true and sources with no `window:` id WHEN listWindows runs THEN it returns `{ access: 'blocked' }`
GIVEN access granted, `blockedWhenNoSources` false and sources with no `window:` id WHEN listWindows runs THEN it returns `{ access: 'granted', windows: [] }`
GIVEN a lister that rejects WHEN listWindows runs THEN it rejects with the lister's error

Tests:
- `screen-capture.test.ts`: one `it.each` table over `listWindows` (the three cases above, plus a window whose number
  is a prefix of another's, `window:12:` against `window:123:`). The deps are `vi.fn` stubs. The blocked row asserts
  that `windows.list` and `sources` were never called.
- `fake-screen-capture.test.ts`: `FAKE_GAME_RECT` lies inside the main window's bounds and outside the floating one,
  and `access: 'blocked'` returns blocked. The fake is test data other tasks rely on, so this guards their premise.

Done when: `npm run typecheck` and `npm run lint` pass (lint runs the layer, composition-root and style checks). The test gate runs
the tests above. No plugin uses the service yet.

Commit: one commit for the group.

## Proof

Commit ce592e64 · proof: diff read: every Produces present (contract types, createScreenCapture, unavailable, electron-capture trio, fake consts, MainServices.screenCapture); wave 1 typecheck and lint pass (one expected unused 'runner' warning until 04) · concerns: screenCaptureFor's macos/windows cases fall through to unavailable with a comment 04 must rewrite; Electron API shapes checked against the spike, not 44.9.1 typings (typecheck passed); AGENTS.md src/main/processes entry does not name requiredStdout (08)
