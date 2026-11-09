# 14 — Fixture user plugin in the self-test

Status: done
Type: Task
Wave: 6 · Depends on: 11, 12, 13 (13 and 14 both edit `src/main/main.ts`)
Plan: [plan.md](plan.md)

The self-test proves the runtime loader end to end. A fixture user plugin is in the temp home's config folder before
the catalog first loads. A core self-test script then proves these things in order:
- the fixture loaded at start, and its command runs
- a save of `main.js` or `page.js` reloads it
- a bad `manifest.json` keeps the last good version and shows the problem
- a user plugin with a built-in's id replaces the built-in, and the built-in comes back when that folder goes
- deleting the fixture's folder takes the fixture out

Files:
- create `src/main/selftest-user-plugin.ts` · test `src/main/selftest-user-plugin.test.ts`
- modify `src/main/main.ts` (seed the fixture before the catalog's first load; hand the script over)
- modify `src/contracts/plugin.ts` (`SelfTestStep.remove` and its doc)
- modify `src/main/selftest-runner.ts` (run `remove`; `stepLabel`) · test `src/main/selftest-steps.test.ts`
- modify `src/main/selftest-config.ts` (`applySelfTestConfig` drops a script page bind of a plugin that is not
  loaded) · test `src/main/selftest-config.test.ts`
- modify `AGENTS.md` § Running and testing: add to the list of self-test scripts
  "`src/main/selftest-user-plugin.ts` for the runtime plugin loader, handed over by `main.ts` under the fixture's id
  `selftest-user`"

Consumes:
- `PluginCatalog.entry(id)`, `.reload(id)`, `.onChanged(listener)` and `CatalogChange` in
  `src/contracts/plugin-catalog.ts` ← 08
- the catalog's creation and its first load in `main.ts` ← 13, and `SelfTestDriver.hostFor` (in the tree)
- the user-folder source: it watches `<config folder>/plugins/`, loads a folder that appears, reloads on a settled
  save, and reports a folder that goes as `gone` ← 08
- a plugin problem is served as `{ file: 'plugins/<id>', message }`, so the page logs `[config] plugins/<id>: <message>`
  ← 09 (`announceNewProblems` in `src/renderer/config-push.ts`)
- page parts loaded from `pageUrl`, `reload` and `remove` answered, and deferred user starts ← 11
- the show's `draw` (`PageLayoutShow.draw(part, parent, input, options?)` in `src/contracts/plugin.ts`), which draws
  a part with the plugin's base kit, and the user plugin's live `layouts/default/` folder in `LayoutService` ← 11
- `UserMainModule` and `UserPageModule` (a named `start(api)` export) ← 08
- `Files.trash` (in the tree; under the self-test the Node adapter deletes for good)
- `PluginSwitch.settled(): Promise<void>` ← 10, and the switch's log lines under source `plugin-switch`:
  `reloaded <id>` and `removed <id>` ← 10
- `AppConfig.plugins: readonly ServedPlugin[]` ← 09
- `SHORT_ID_PATTERN` (`^[A-Za-z][A-Za-z0-9]*$`) for command and scope keys, and no scope named `any` ← 02

Produces:
- `SelfTestStep.remove?: string` in `src/contracts/plugin.ts`. Doc: "`remove`, when set, removes the file or
  folder at `path` (relative to the self-test's temp home, as `writeFile`'s path is) after the write and before the
  keys, as an outside program deleting it would; one that resolves outside the home fails the self-test." The runner
  calls `homeFiles.trash(step.remove)`. `stepLabel` adds `remove <path>` after `write <path>`.
- In `src/main/selftest-user-plugin.ts`:
  ```ts
  export const SELFTEST_USER_ID = 'selftest-user';
  // Writes the fixture's first version (manifest.json, main.js, page.js,
  // layouts/default/layout.js) into `<pluginsFolder>/selftest-user/`.
  export function seedSelfTestUserPlugin(deps: { files: Files; paths: Paths; pluginsFolder: string }): Promise<void>;
  export interface UserPluginSelfTestDeps {
    homeFiles: Files; // rooted at the temp home, as the runner's `homeFiles`
    catalog: Pick<PluginCatalog, 'entry' | 'reload' | 'onChanged'>;
    settled(): Promise<void>; // resolves once the plugin switch's queue holds no work
    log: Log;
  }
  export function userPluginSelfTestScript(deps: UserPluginSelfTestDeps): SelfTestScript;
  ```
  `main.ts` passes `settled: () => pluginSwitch?.settled() ?? Promise.resolve()` (the `pluginSwitch` variable that
  `createWindow` declares before the hand-over and sets once the switch exists; the script's `open` runs after
  that) and `log: pageLog.log`.
- In `src/main/selftest-config.ts`: `applySelfTestConfig` drops each script page bind whose command is not in
  `config.commands` and whose text before the first `.` names no plugin in `config.plugins`. Every other script
  bind is kept, so a typo in a loaded plugin's command still fails as today. Its doc comment says so. Reason: the
  fixture's `selftest-user.hello` bind is added after the store, so task 09's rule for absent plugins never sees
  it. After step 12 the served keymap would hold a bind with no command, the page's `requireRegistered` would
  throw, and the push would refuse the keys with a config problem while the run still passed.

Decisions:
- **Host: a core script under the fixture's id, not a plugin's script.** `main.ts` calls
  `selfTest.hostFor(SELFTEST_USER_ID).run(userPluginSelfTestScript(...))` after the main parts start and before
  `closeHandover()`. `hostFor` takes any id, so this goes through no plugin. Reasons:
  - The steps check the catalog itself ("loaded at start", "gone after delete"), and no plugin can read the catalog.
  - The settings script's result is tied to its own emptied `settings.json` and `keymap.json`. Loader steps there
    would mix two fixtures in one result.
  - The filter name matches what is tested: `npm run selftest -- --plugin selftest-user`.
  - It is handed over last, so it runs after every other script, and its replacement of `gallery` is undone before
    the run ends.
  - Screenshots, if any are added later, save as `selftest-user-<name>.png`.
- **Seed before the first load.** Only in `main.ts` when `runMode === 'selfTest'`: await
  `seedSelfTestUserPlugin({ files, paths, pluginsFolder: path.join(configFolder(inputs.homeDir), 'plugins') })`
  before the catalog's first load (task 13's `loadAll` call). A drive run and a live run never seed. The temp home is
  new each run, so the seed never overwrites user files.
- **Fixture, first version (v1).** All paths are under `.config/wigley-ai-gui/plugins/selftest-user/`. The texts
  live as constants in `selftest-user-plugin.ts`. Each `.js` text starts with `// @ts-check` and the JSDoc `@import`
  line task 07 pins (`from '../_types/plugin'`), so the fixture is also the worked example.
  - `manifest.json`: `$schema` `"../_types/manifest.schema.json"`, id `selftest-user`, label
    `Self-test user plugin`, description `A user plugin the self-test loads, reloads, breaks and removes.`,
    `dependsOn` and `reads` both `{ "main": [], "page": [] }`, commands
    `{ "hello": { "label": "say hello", "group": "selftest", "runsIn": "page" } }`, and `scopes`, `settings`,
    `settingInfo`, `themeTokens` all `{}`. If task 02 refuses `$schema`, drop the key and report it.
  - `main.js`: `export function start(api)` logs `main started v1` through `api.services.log`, calls
    `api.layouts.register({ layoutTypes })`, and returns the `UserMainStart` with no commands. `layoutTypes` is a
    text that imports `BaseKit` from `'../kit'` and exports `interface Layout` with one optional part,
    `hello?(parent: HTMLElement, input: { text: string }, kit: BaseKit): { element: HTMLElement }`.
  - `page.js`: `export function start(api)` logs `page started v1` and returns commands
    `{ hello: () => api.services.log('hello from v1') }`. If the page API's log is not under `api.services.log`, use
    the page API's plugin log, whatever its name. Each line must log under the plugin's id, so the page shows
    `[selftest-user] …`. Before it returns, it draws its default layout through its kit:
    - It makes a `div` holder and does not mount it, so no other script's screen changes.
    - It calls `api.layouts.show` with: `defaultLayout` a fallback whose `hello` returns
      `{ element: kit.el(parent, 'span', '', 'fallback') }`; `defaultStylesheet: null`; `read` that returns the
      module's `default` export and throws `layout has no hello` when its `hello` is not a function;
      `userLayout: () => 'default'`; and `setLayouts` that redraws.
    - A redraw disposes the last draw, empties the holder, calls `show.draw('hello', holder, { text: 'v1' })`, and
      logs `layout <layoutName> drew: <built.element.textContent>` from what `draw` returns.
    - It passes the show's handle to nothing else: a part stop disposes the show and its draws (task 11).
  - `layouts/default/layout.js`: a default export whose `hello(parent, input, kit)` returns
    `{ element: kit.el(parent, 'span', 'selftest-user-hello', 'layout v1') }`. It ignores `input`. It goes through
    task 11's live user default folder, and the page part draws it with the plugin's base kit. A kit that did not
    reach the layout would throw, and the fallback would draw `fallback` in its place.
- **Second version (v2)**, written by steps: `main.js` the same as v1 but logging `main started v2`; `page.js` the same
  as v1 but logging `page started v2`, with `hello` logging `hello from v2`; `layouts/default/layout.js` the same as
  v1 but drawing `layout v2`.
- **Bad manifest:** the text `{"id": "selftest-user"}`. It fails `validateManifest` (no label, and so on).
- **The replacement:** `gallery`, chosen for these reasons:
  - It is enabled by default (`plugins.disabled` defaults to `agent-lines`, `usage-tab-line` and
    `docs-session-tab`, and a replacement under a disabled id would never start).
  - No manifest names it in `dependsOn` or `reads`.
  - No self-test script sets its settings.
  - It is a debug view that no later script needs.
  - `usage-tab-line` and `agent-lines` were rejected, because both are disabled by default.

  Its files are under `.config/wigley-ai-gui/plugins/gallery/`:
  - `manifest.json`: id `gallery`, label `Gallery (user)`, description `Replaces the built-in gallery in the
    self-test.`, no commands, and every other field empty, as v1's are.
  - `page.js`: `start(api)` logs `replaced by a user plugin` and returns `{ commands: {} }`.

  Gallery's default binds drop with a log line, because the replacement declares none of its commands (task 09).
- **Page bind** (the script's `pageBinds`):
  `{ keys: [' ', 'z', 'u'], scope: 'any', command: 'selftest-user.hello' }`. Before writing it, check with
  `grep -n "<Leader>zu" src/plugins/keymap.ts` that no default uses `<Leader>zu`. On a hit, pick the next free
  `<Leader>z` letter and change every step's keys to match.
  - The bind is served on every self-test run, filtered or not. The seeded fixture declares the command, so it is
    never a problem.
  - After the folder goes, `applySelfTestConfig` drops the bind, because `selftest-user` is no longer in
    `config.plugins` (see Produces).
  - Every key and scope name in the fixture matches `SHORT_ID_PATTERN` (`hello`), and the fixture declares no scope.
    `any` in the bind is the core scope, not a fixture scope.
- **`open(run)` puts v1 back every run.** A run that a page reload stood down may have left v2, a bad manifest, or a
  gallery folder. `open` returns at once and runs these steps in order, in one async chain:
  1. Disposes the previous run's `onChanged` listener.
  2. Awaits `settled()`, so the switch's launch job (which starts the fixture after launch) is done.
  3. Trashes `plugins/gallery` when it exists.
  4. Reads each v1 file and writes only those that are missing or different. If the folder is gone, all of them
     are written.
  5. When step 4 wrote no file outside `layouts/`, awaits `catalog.reload('selftest-user')`. Else it awaits the
     first `onChanged` change whose `added` or `reloaded` holds `selftest-user` (the watcher's load). So exactly one
     reload follows each open. A write under `layouts/` counts as no write here, because task 08's watcher skips
     `layouts` paths and no catalog change follows it.
  6. Awaits `settled()` again, so the switch has started the main and page parts and reapplied the binds.
  7. Logs `fixture ready for run <run>` through `log` under source `selftest-user`.

  `shownLine` is `[selftest-user] fixture ready for run <run>`, with no `alsoShown`. Reason: the launch job's
  `main started v1` and `page started v1` lines can come after the runner's log mark, so a start line could show the
  script before `open`'s own reload ran, and step 1's keys would race it. The ready line comes only after step 6.
  The `result` is set up in `open`, as below.
- **"Loaded at start"** is checked from the catalog, not from a line, because the start line is logged before any
  script opens. `userPluginSelfTestScript` reads `catalog.entry('selftest-user')` when it is called, during hand-over
  and after the first load. It records `loadedAtStart` = the entry exists, its origin is `user`, and its revision is
  `1`.
- **`result`** resolves on the first `onChanged` change, after `open`, whose `removed` holds `selftest-user`. It
  resolves to `{ loadedAtStart, galleryOrigin: catalog.entry('gallery')?.origin ?? null, isStillHeld:
  catalog.entry('selftest-user') !== undefined }`.

  `problems(result)` returns, in this order and only when each is true:
  - `selftest-user was not loaded at start`
  - `gallery is <origin> after its user folder went, not built-in` (with `none` for null)
  - `selftest-user is still in the catalog after its folder went`

  `scrollsItself: []`, `settings: {}`.
- **Groups and steps.** Each `expect` is matched exactly. All paths below are relative to the temp home, with the
  prefix `P = .config/wigley-ai-gui/plugins`.

  | # | Group | Step | `expect` | `alsoExpect` / why |
  |---|---|---|---|---|
  | 1 | load at start | keys `␣ z u` | `[selftest-user] hello from v1` | why: the page part loaded from `wigley-plugin:` started deferred and registered `hello` |
  | 2 | reload on save | write `P/selftest-user/main.js` v2, keys none | `[selftest-user] main started v2` | why: a settled save reloads main from a new revision copy |
  | 3 | reload on save | write `P/selftest-user/page.js` v2, keys none | `[selftest-user] page started v2` | — |
  | 4 | reload on save | keys `␣ z u` | `[selftest-user] hello from v2` | why: the bind reaches the reloaded page part's handler |
  | 5 | layout draws through its kit | write `P/selftest-user/layouts/default/layout.js` v2, keys none | `[selftest-user] layout default drew: layout v2` | why: a save of the user's default layout reloads it alone, and the page part draws it with its base kit |
  | 6 | bad manifest | write `P/selftest-user/manifest.json` bad, keys none | `[config] applied a new config` | alsoExpect `/^\[config\] plugins\/selftest-user: /` |
  | 7 | bad manifest | keys `␣ z u` | `[selftest-user] hello from v2` | why: the failed load kept the last good version running |
  | 8 | bad manifest | write `P/selftest-user/manifest.json` v1, keys none | `[selftest-user] main started v2` | why: a good save loads again, with v2's `main.js` still on disk |
  | 9 | replace a built-in | write `P/gallery/page.js`, keys `␣ z u` | `[selftest-user] hello from v2` | why: a save in another plugin's folder leaves the fixture running |
  | 10 | replace a built-in | write `P/gallery/manifest.json`, keys none | `[gallery] replaced by a user plugin` | why: the user plugin with the built-in's id starts in its place |
  | 11 | replace a built-in | remove `P/gallery`, keys none | `[plugin-switch] reloaded gallery` | why: the built-in comes back, and its parts run again; the result checks its origin |
  | 12 | delete | remove `P/selftest-user`, keys none | `[plugin-switch] removed selftest-user` | why: the folder going stops the plugin's parts and takes it out; the result checks the catalog |

  Step 5's line names `default` for both the live default and the fallback, so the text decides: `layout v2` comes
  only from the saved `layout.js`, drawn with the kit. The `layout v1` draws after `open` and step 3 cannot match it.

  Step 9 makes no claim about a folder with no `manifest.json`: step 10's write lands inside the `PLUGIN_SETTLE_MS`
  window, so the source loads the gallery folder once, with both files. Steps 11 and 12 wait on
  the switch's own lines (task 10), which it logs at the end of the job, after the page answered. A trailing
  `[config] applied a new config` from an earlier step cannot satisfy them.

  Group `why`s:
  - **load at start:** "The fixture in the config folder at start loaded, and its page command runs from a key."
  - **reload on save:** "Saving main.js and page.js reloads each with the new code."
  - **layout draws through its kit:** "The plugin's own default layout draws through its layout kit, and a save of it
    redraws with no plugin reload."
  - **bad manifest:** "A manifest that fails its checks shows a config problem and keeps the last good version
    running, and a good save loads again."
  - **replace a built-in:** "A user plugin with gallery's id replaces the built-in, and the built-in comes back when
    its folder goes."
  - **delete:** "Deleting the fixture's folder takes it out of the catalog."
- **Files go in through steps, not script code.** Every change after `open` comes from a step's `writeFile` or
  `remove`, as an outside editor would make it, so the watcher and the settle path are what get tested.

GIVEN the fixture v1 on disk and nothing else WHEN `open` runs THEN it awaits `settled`, writes nothing, calls
`catalog.reload` once, awaits `settled` again, and only then logs `fixture ready for run <run>`.
GIVEN `main.js` v2 on disk and a `plugins/gallery` folder WHEN `open` runs THEN it writes only `main.js`, trashes the
gallery folder, does not call `catalog.reload`, and logs the ready line only after a change reloads `selftest-user`.
GIVEN only `layouts/default/layout.js` v2 on disk WHEN `open` runs THEN it writes `layout.js` v1, calls
`catalog.reload` once, and logs the ready line after the second `settled`.
GIVEN a served config whose `plugins` lacks `selftest-user` and a script bind to `selftest-user.hello` WHEN
`applySelfTestConfig` runs THEN the bind is not in the served page keymap; a script bind to an unknown command of a
loaded plugin stays.
GIVEN a catalog that held the fixture at revision 1 at hand-over WHEN the change that removes it arrives with gallery
built in THEN `problems` is empty.
GIVEN a step with `remove` WHEN it runs THEN the path is trashed after the write and before the keys, and the report
label names `remove <path>`.

Tests:
- `src/main/selftest-user-plugin.test.ts` (in-memory `Files`, a fake catalog recording `reload` and firing
  `onChanged`, a fake `settled` that records each call and resolves when the test says, and a recording `log`):
  - `open_WritesOnlyChangedFilesElseReloads`, a table with these rows: fresh v1 (no write, one reload);
    `main.js` v2 (writes `main.js` only, no reload); folder gone (writes all four files, no reload); gallery folder
    present with v1 (trashed, one reload); `layouts/default/layout.js` v2 only (writes it, one reload). Each row
    asserts the order `settled`, file work, reload or change, `settled`, ready line. It breaks if `open` always
    rewrites (a double reload races step 1), never reloads (no shown line), waits after a layout-only write for a
    catalog change that never comes, or logs the ready line before the second `settled` resolves.
- `src/main/selftest-config.test.ts`: add rows to the `applySelfTestConfig` test (make it an `it.each` table if it
  is one case): a bind to a command of a plugin not in `config.plugins` (dropped); a bind to an unknown command of a
  plugin in `config.plugins` (kept); a bind to a known command (kept). It breaks if the fixture's bind outlives the
  fixture, or if a typo in a loaded plugin's bind is hidden.
  - `problems_NamesEachFailedCheck`, a table with these rows: all good → `[]`; not loaded at start; gallery `user`;
    gallery null → `none`; still held. Assert the full lists. The lines are read by the agent from the run report.
  - `result_ResolvesOnTheChangeThatRemovesTheFixture`: a change removing `other` leaves it pending; one removing
    `selftest-user` resolves it. It breaks if any change resolves it.
- `src/main/selftest-steps.test.ts`: add one row to the existing `it.each` that covers a step's write (or a new test
  `runStep_Remove_TrashesBeforeTheKeys` if no table owns the write rule). It asserts the trash call comes after the
  write and before the first key, and that the report label holds `remove <path>`. It breaks if `remove` runs after
  the keys or is skipped.
- Run: `npm run selftest -- --plugin selftest-user`. Task 16 also runs it in its gate.

Done when: compiles; `npm run lint` passes; the tests above pass by name; `npm run selftest -- --plugin
selftest-user` reports `[selftest] all passed`.
Commit:    one commit for the task

Concerns:
- Step 6 waits on `[config] applied a new config` (`src/renderer/config-push.ts`), and its `alsoExpect` pins the
  problem line, which only the bad manifest causes. If a run shows the problem line missing, read the problem's
  served path from task 09's code, fix the pattern, and record the change in the Proof.
- Steps 11 and 12 wait on task 10's `reloaded <id>` and `removed <id>` lines. `reloaded <id>` is logged only when the
  new entry runs; a failed reload logs `reload of <id> failed: <message>; the last good version runs` (or
  `…; the last good version failed too: <second message>`) instead. If step 11 times out, read the log for those
  lines before anything else.

## Proof

Commit 3ceee39b · proof: diff read: seed before startCatalog in selfTest mode, script handed over last before closeHandover, SelfTestStep.remove + runner + stepLabel, applySelfTestConfig drop rule; typecheck 0, lint 0, 80 tests in 3 files pass; selftest --plugin selftest-user: 12 steps PASS, result as expected, all passed · concerns: layout.js has @ts-check but no @import (../_types/plugin does not resolve from layouts/default); fixture seeded on every self-test run so other scripts run with selftest-user loaded (<Leader>zu bind, a Plugins row) — whole-run effect untested
