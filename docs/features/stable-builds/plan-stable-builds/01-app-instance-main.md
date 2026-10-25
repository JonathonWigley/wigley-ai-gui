# 01 — App instance chosen in main and handed to plugins and the page

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     create `src/contracts/app-instance.ts` · create `src/main/app-instance.ts` · test `src/main/app-instance.test.ts`
           · modify `src/main/main.ts` · modify `src/contracts/plugin.ts` · modify `src/contracts/settings.ts`
           · modify `src/main/config/config-store.ts` · modify every test fake of `MainServices` or `AppConfig` the
           compiler flags (measured at plan time, re-verify: `main-api.test.ts`, `claude-code-harness.test.ts`,
           `user-config.test.ts`, `selftest-config.test.ts`, chat and docs `start.test.ts`, forms layout tests,
           `page-api.test.ts`)
Consumes:  nothing
Produces:  `export interface AppInstance { id: 'wigley-ai-gui' | 'wigley-ai-gui-dev'; displayName: 'Auri' | 'Auri Dev'; isDev: boolean }`
           in `src/contracts/app-instance.ts`
           `export function appInstanceOf(isPackaged: boolean): AppInstance` in `src/main/app-instance.ts`
           `appInstance: AppInstance` on `MainServices` in `src/contracts/plugin.ts`
           `appInstance: AppInstance` on `AppConfig` in `src/contracts/settings.ts`
           `appInstance: AppInstance` on `ConfigStoreDeps` in `src/main/config/config-store.ts`, served as
           `AppConfig.appInstance`
Decisions: stable vs dev from `app.isPackaged`, read once (interview) · one record crosses to plugins and the page
           (design review: locality) · only stable registers global shortcuts (Q5) · user config folder unchanged
           and shared (Q4) · dev starts with empty user data, nothing copied (design review)

**Pinned values**

- `appInstanceOf(true)` → `{ id: 'wigley-ai-gui', displayName: 'Auri', isDev: false }`
- `appInstanceOf(false)` → `{ id: 'wigley-ai-gui-dev', displayName: 'Auri Dev', isDev: true }`

**main.ts changes**

- A module-level `const appInstance = appInstanceOf(app.isPackaged);` beside `runEnvironment`.
- **User data, live only:** before `app.requestSingleInstanceLock()` (today line ~848, at module load) a live run
  calls `app.setPath('userData', path.join(app.getPath('appData'), appInstance.id))`. The lock is keyed on the user
  data folder, so this one call also splits the locks. Drive runs keep their own `setPath` in `startApp`; the
  self-test is unchanged. A failed `setPath` goes through `failStart`.
- **Window title:** the main window is created with `title: appInstance.displayName` (pass it through
  `createMainWindow`'s options in `src/main/window.ts` if that function builds the options; add the file to Files
  then).
- **Global shortcuts:** both `registerGlobalShortcuts` calls in `createWindow` run only when
  `runMode === 'live' && !appInstance.isDev`. The `globalShortcut.unregisterAll()` calls stay as they are.
- **Services:** `startMainParts`' services object gets `appInstance`.
- **Config:** `configStoreDeps` passes `appInstance`; the ConfigStore serves it as `AppConfig.appInstance` next to
  `platform` and `homeDir`.
- **Drive harness:** `driveHarness` sets `WIGLEY_AI_GUI_ENDPOINT_DIR` to
  `path.join(homeDir, '.agents', appInstance.id)`, replacing the literal `'wigley-ai-gui'`, so a dev drive run's
  Claude sessions find the endpoint folder group 02 writes.
- `failStart`'s dialog title and stderr line keep `wigley-ai-gui` (they name the program, not the shown app).

GIVEN `isPackaged` true WHEN `appInstanceOf` runs THEN it returns the stable record above
GIVEN `isPackaged` false WHEN `appInstanceOf` runs THEN it returns the dev record above

Tests:     `src/main/app-instance.test.ts` — `appInstanceOf(true)` equals the stable record;
           `appInstanceOf(false)` equals the dev record (both asserted with the literal values above)
Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above
Commit:    one commit for the group

## Proof

