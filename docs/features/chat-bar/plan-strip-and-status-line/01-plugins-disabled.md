# 01 — The plugins.disabled setting

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/settings.ts` · modify `src/config/settings.ts` ·
           modify `src/shared/plugin-host.ts` · test `src/shared/plugin-host.test.ts` ·
           modify `src/shared/plugin-manifests.ts` · test `src/shared/plugin-manifests.test.ts` ·
           modify `src/main/config/config-checks.ts` · test `src/main/config/config-store.test.ts` ·
           modify `src/main/main.ts` · modify `src/main/selftest-config.ts` · test `src/main/selftest-config.test.ts` ·
           modify `src/renderer/renderer.ts` · test `src/plugins/manifests.test.ts` ·
           modify `src/plugins/settings/main/selftest-script.ts` ·
           modify (a `Settings` or `AppConfig` fixture gains `plugins: { disabled: [] }`):
           `src/main/config/user-settings.test.ts`, `src/main/config/user-config.test.ts`,
           `src/renderer/installed-config.test.ts`, `src/renderer/plugins/page-api.test.ts`,
           `src/renderer/config-push.test.ts`, `src/shared/empty-user-files.test.ts`,
           `src/plugins/settings/main/selftest-script.test.ts`
           (the fixture list was measured at plan time with `grep -rln "keySequenceTimeoutMs:" src`; re-verify: the
           compiler names each one that misses the new member)
Consumes:  `startPlugins(parts, start, known)` in `src/shared/plugin-host.ts` (tree today) ·
           `checkSettingsText(text, deps, schema)` in `src/main/config/config-checks.ts` (tree today) ·
           `applySelfTestConfig(config, selfTest)` in `src/main/selftest-config.ts` (tree today) ·
           `CommandInfo.plugin` in `src/contracts/plugin.ts` (tree today)
Produces:  `plugins: { disabled: string[] }` in `Settings`, `src/contracts/settings.ts` (plan File Structure)
           `defaultSettings.plugins = { disabled: ['agent-lines', 'usage-tab-line'] }` in `src/config/settings.ts`
           `settingInfo['plugins.disabled']` in `src/config/settings.ts`
           `export function disabledDependencyProblem(disabled: readonly string[], manifests: readonly PluginManifest[]): string | null`
             in `src/shared/plugin-manifests.ts`
           `export function withoutPluginBinds(keymap: Keymap, commands: Record<CommandId, CommandInfo>, pluginIds: readonly string[], side: 'main' | 'page'): Keymap`
             in `src/shared/plugin-manifests.ts`
           `startPlugins(parts, start, known, disabled: readonly string[] = [])` in `src/shared/plugin-host.ts`

## Decisions

- **Plugin ids keep their `-`.** `definePlugin` checks ids against `/^[a-z0-9-]+$/` (`src/shared/define-plugin.ts`), and
  the layout service checks owners against the same pattern (`src/main/layouts/layout-service.ts`). Both accept
  `agent-lines`, `agent-strip` and `usage-tab-line`. Write this ruling in `plan.md`'s Run log, § Rulings, in the task's
  commit: "Plugin ids keep `-` (`agent-lines`, `agent-strip`, `usage-tab-line`): `definePlugin` and the layout service
  accept `[a-z0-9-]`." No later task changes its ids.
- **The setting.** `Settings` gains `plugins: { disabled: string[] }`. The default is
  `['agent-lines', 'usage-tab-line']`. The existing settings merge already checks it: an array replaces the default
  whole, and each element must be a string, because the default's first element is a string
  (`checkElements` in `src/main/config/user-settings.ts`). `[]` is valid. No plugin may have the id `plugins` now
  (`requireNoCoreSettingIds` already throws on that at startup); no built-in plugin has it.
- **Unknown ids are allowed.** The list may name an id no manifest has. Reasons: the default names `agent-lines` and
  `usage-tab-line` before tasks 07 and 08 add them, and a user's list may outlive a removed plugin. Such an id
  disables nothing.
- **The dependency rule.** `disabledDependencyProblem` walks `manifests` in list order. For each manifest whose id
  is not in `disabled`, it looks at each `dependsOn` id in order. The first one in `disabled` gives the problem text,
  verbatim: `"plugins.disabled" names "<dependency>", which "<dependent>" depends on.` It returns null when no
  started plugin depends on a disabled one. A dependent that is itself in the list is no problem.
- **The config check.** `checkSettingsText` runs the rule on the merged settings' `plugins.disabled` against
  `deps.manifests`. A problem throws an Error with that text. The ConfigStore then reports it on `settings.json` and
  keeps the last good settings, as for every other settings problem: the title-bar badge and the toast show it. The
  `userConfig` service runs the same check, so Settings mode refuses to write such a list.
- **The plugin host.** `startPlugins` takes a fourth parameter, `disabled` (default `[]`). It drops every part whose
  manifest id is in `disabled` before any other check, and starts the rest as today. The returned map holds no
  disabled id. A kept part that depends on a disabled one throws, with the text of `disabledDependencyProblem`
  over the kept parts' manifests. The config check makes this unreachable from the user's files; the throw guards
  a composition root that hands the host an unchecked list.
- **Where each process reads the list.**
  - Main: `startMainParts` passes `store.current().settings.plugins.disabled`, read once at app start, as
    `disabled`. Keep that list in `main.ts` as the main start list. Under the self-test, pass `[]` (see Self-test,
    below).
  - Page: `renderer.ts` passes `config.settings.plugins.disabled` of the config read at page load. Keep that list for
    the page's life as the page load list. A pushed config does not change it.
  - `requireListed` and `requireServedSettings` stay as they are. A disabled part is skipped before
    `requireServedSettings` runs, since the host never calls `start` for it.
- **Manifests merge whole; binds of unstarted plugins drop per process.** A disabled plugin's manifest stays in
  `src/plugins/manifests.ts` and merges as today: its commands, scopes, settings, theme tokens and keys. Reasons:
  - The served config then does not depend on the list, so changing the list never makes `settings.json`,
    `keymap.json` or a theme invalid. The user's settings under a disabled plugin's id stay valid, Settings mode keeps
    its rows, a user keymap bind on its command stays valid, and a theme naming its tokens still loads.
  - The keymap check (`CommandRegistry.requireRegistered`) fails on a bind naming no registered command. A
    disabled plugin registers no handler. So each process drops the binds of the plugins it did not start, before
    its check and its install, through `withoutPluginBinds`:
    - `side: 'main'` drops each `app`, `intercept` and `global` bind whose command's plugin
      (`commands[bind.command].plugin`) is in `pluginIds`. It leaves `editor`, `page` and `groups` unchanged.
    - `side: 'page'` drops each `editor.binds` and `page` bind whose command's plugin is in `pluginIds`. It leaves
      `editor.leader`, `editor.remaps`, `app`, `intercept`, `global` and `groups` unchanged.
    - A bind whose command is not in `commands` stays, so `requireRegistered` still reports it.
  - Main: `served()` in `main.ts` returns `applySelfTestConfig(...)` with its keymap passed through
    `withoutPluginBinds(keymap, commands, mainStartList, 'main')`. Every main-side install reads `served()`, so the
    window keybindings, the app menu and the global shortcuts never see those binds.
  - Page: `renderer.ts` passes the config read at load, and each config the page receives after
    (`bridge.onConfig`), through `withoutPluginBinds(keymap, commands, pageLoadList, 'page')` before anything reads
    it. Do this in one local helper at the two entry points. Then the live config, the keys plugin (help, which-key,
    anchors) and the installed page and editor binds all see only started plugins' binds.
  - Why the page filters with its own load list, not main with the current list: a list edited mid-run must not
    serve a page bind whose plugin the running page has not started. That bind would fail the page's
    `requireRegistered` and refuse every keymap push until the next page load.
- **Settings mode shows the list today; no change.** `settingControl` in `src/main/config/user-config.ts` gives an
  array setting the `json` control. Settings mode draws its value as JSON on the row
  (`["agent-lines","usage-tab-line"]`) and edits it in the JSON document box. Its row needs only `settingInfo`:
  - label: `Disabled plugins`
  - description: `Plugin ids the app does not start. A page part follows on the next page load, a main part on the next app start.`
- **Self-test.** The self-test starts every plugin, so the agents and usage steps, and the steps tasks 07 and 08 add,
  see their views:
  - `applySelfTestConfig` sets the served `settings.plugins.disabled` to `[]`. Add this to its comment.
  - `main.ts` passes `[]` as the main start list when `runMode === 'selfTest'`, with a comment that names
    `applySelfTestConfig` as the page's half of the same rule. Main parts start before the scripts are handed over,
    so main cannot read the self-test's served config at that point.
  - A drive run keeps the defaults, so `agent-lines` and `usage-tab-line` are off there until its home's
    `settings.json` turns them on.
- **Live stop is out of scope** (plan.md § Out of scope). A list change does nothing to running parts.

## GIVEN / WHEN / THEN

- GIVEN `settings.json` is missing WHEN the app starts THEN the served `settings.plugins.disabled` is
  `['agent-lines', 'usage-tab-line']`, and neither process starts a part with those ids.
- GIVEN `{"plugins":{"disabled":["notes"]}}` WHEN main and the page start THEN neither starts a notes part, and no
  notes bind reaches either process's keymap check or install.
- GIVEN `{"plugins":{"disabled":["sessions"]}}` and a started plugin depending on `sessions` WHEN the ConfigStore reads
  it THEN `settings.json` has the problem `"plugins.disabled" names "sessions", which "<first dependent>" depends on.`
  and the last good settings stay.
- GIVEN `{"plugins":{"disabled":["no-such-plugin"]}}` WHEN the ConfigStore reads it THEN there is no problem.
- GIVEN `{"plugins":{"disabled":[3]}}` WHEN the ConfigStore reads it THEN `settings.json` has a problem naming
  `plugins.disabled[0]` (the existing element check).
- GIVEN the self-test WHEN it starts THEN every plugin starts in both processes.
- GIVEN Settings mode, Core section WHEN the user filters on `disabled` THEN the first row is `plugins.disabled`.

## Tests

- `plugin-host.test.ts`, `describe('startPlugins')`, new cases:
  - `skips a disabled part and starts the rest in order` — parts a, b, c, disabled `['b']`: start order `['a', 'c']`
    and the map holds no `b`. Catches a host that ignores the list.
  - `rejects a kept part that depends on a disabled one` — parts a, b(dependsOn a), disabled `['a']`: throws
    matching `/"a".*"b"/`. Catches a part started with an undefined dependency.
  - `ignores a disabled id with no part` — parts a, disabled `['z']`: starts `['a']`. Catches a host that throws on
    ids tasks 07 and 08 have not added yet.
- `plugin-manifests.test.ts`, new `describe('disabledDependencyProblem')`, one `it.each` table. Manifests a, b(dependsOn
  a), c(dependsOn b):
  | disabled | expected |
  |---|---|
  | `[]` | `null` |
  | `['a']` | `"plugins.disabled" names "a", which "b" depends on.` |
  | `['a', 'b']` | `"plugins.disabled" names "b", which "c" depends on.` |
  | `['a', 'b', 'c']` | `null` |
  | `['c']` | `null` |
  | `['zzz']` | `null` |
  Catches a rule that misses a dependent, reports a disabled dependent, or rejects an unknown id.
- `plugin-manifests.test.ts`, new `describe('withoutPluginBinds')`, one `it.each` table over one keymap holding one
  bind of each kind (`editor.binds`, `page`, `app`, `intercept`, `global`) for plugin `p`, one `page` bind for plugin
  `q`, and one `page` bind naming a command not in `commands`. Rows: `side: 'page'` with `['p']` drops p's editor
  and page binds only; `side: 'main'` with `['p']` drops p's app, intercept and global binds only; `[]` returns the
  keymap equal to the input; the unknown-command bind stays in every row. Catches a filter that drops the other
  process's binds, or drops a bind `requireRegistered` should still report.
- `config-store.test.ts`. The test's `DEFAULTS` gains `plugins: { disabled: [] }`.
  - The `it.each` table `settings.json $text → problem naming $problem` gains two rows:
    `{"plugins":{"disabled":["nope"]}}` → no problem, served `{ settings: { plugins: { disabled: ['nope'] } } }`;
    `{"plugins":{"disabled":[3]}}` → problem naming `plugins.disabled[0]`, served `DEFAULTS`.
  - New case `keeps the last good settings when the list disables a needed plugin`: deps whose `manifests` are
    the test's `listPlugin` (id `p`) and a second `definePlugin` with id `q` and `dependsOn: ['p']`, built for this
    case only so the shared table's plugin defaults stay as they are. `settings.json` is
    `{"plugins":{"disabled":["p"]}}`. The served settings equal the defaults, and `problems` is one problem on
    `settings.json` with the message `"plugins.disabled" names "p", which "q" depends on.`
  Catches a ConfigStore that serves a list a started plugin cannot live with, or rejects an unknown id.
- `selftest-config.test.ts`, `applySelfTestConfig` test: its fixture's settings gain
  `plugins: { disabled: ['p'] }`, and it asserts `served.settings.plugins.disabled` equals `[]`. Catches a self-test
  that serves the default list and hides the views its steps wait for.
- `src/plugins/manifests.test.ts`, new case `manifests_DefaultDisabled_BreaksNoDependency`:
  `disabledDependencyProblem(defaultSettings.plugins.disabled, manifests)` is `null`. Catches a default list that
  breaks a built-in plugin once tasks 07 and 08 add theirs.
- Self-test: settings' script gains a group `disabled plugins` after `timeout reset`, why `Filtering Core on
  disabled finds the plugins.disabled row.`, with one step: keys `['/', ...'disabled', 'Enter']`, expect
  `[settings] filter "disabled" first row plugins.disabled`. Keep the script's result check passing: the step writes
  nothing.

## Done when

`npm test` passes with the cases above; `npm run lint` passes; `npm run selftest -- --plugin settings` passes.

## Commit

One commit for the group, with the Run log ruling on plugin ids.

## Proof

