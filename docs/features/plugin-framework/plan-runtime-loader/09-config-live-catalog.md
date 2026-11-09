# 09 — Config over a live catalog

Status: not started
Type: Task
Wave: 3 · Depends on: 05, 08
Plan: [plan.md](plan.md)

Files:
- modify `src/main/config/config-store.ts` · test `src/main/config/config-store.test.ts`
- modify `src/main/config/config-checks.ts`
- modify `src/main/config/user-settings.ts` · test `src/main/config/user-settings.test.ts`
- modify `src/main/config/user-keymap.ts` · test `src/main/config/user-keymap.test.ts`
- modify `src/main/config/user-config.ts` · test `src/main/config/user-config.test.ts`
- modify `src/contracts/settings.ts`
- modify `src/shared/plugin-manifests.ts` · test `src/shared/plugin-manifests.test.ts`
- modify every test fixture that builds a whole `AppConfig` (add `plugins: []`): `npm run typecheck` lists them.
  At plan time they include `src/shared/plugin-part-harness.test-support.ts`, `src/main/selftest-config.test.ts` and
  `src/renderer/plugins/page-api.test.ts`.

Consumes:
- `CatalogEntry`, `CatalogProblem`, `ServedPlugin`, `PluginOrigin` in `src/contracts/plugin-catalog.ts` ← 08
- `AppliedPlugins.paused()` and `withAppliedList(config, disabled, paused = [])` ← 05 (the store does not call them;
  this task keeps 05's third parameter intact while it edits `plugin-manifests.ts`)

Produces:
- `src/contracts/settings.ts`: `AppConfig` gains `plugins: readonly ServedPlugin[]` — one per admitted plugin, in
  catalog order.
- `src/main/config/config-store.ts`, on `ConfigStore`:
  ```ts
  // The entries the served config holds now, in catalog order: what the
  // last `setPlugins` (or the load) admitted.
  plugins(): readonly CatalogEntry[];
  // Hands over the entries to serve, in catalog order. Admits them (below),
  // rebuilds the schema and the plugin theme tokens, and re-serves. Runs in the
  // store's one rebuild queue with file and runtime rebuilds. Resolves once a
  // rebuild that started after the call has published or failed. Never
  // rejects: a failed rebuild logs `config not read: <error>` and keeps the
  // last admitted entries. The caller reads `plugins()` after it resolves to
  // learn what the store admitted.
  setPlugins(entries: readonly CatalogEntry[]): Promise<void>;
  // The problems of the last admission: an entry the schema refused.
  pluginProblems(): readonly CatalogProblem[];
  // Problems from outside the store (the catalog's and the switch's), served
  // after the store's own. A changed list re-serves.
  setPluginProblems(problems: readonly CatalogProblem[]): void;
  // The check deps and schema over the admitted entries, for user-config.
  checks(): { deps: ConfigCheckDeps; schema: ConfigSchema };
  ```
- `ConfigStoreDeps` becomes `Omit<ConfigCheckDeps, 'manifests' | 'themeTokens'>` plus
  `plugins: readonly CatalogEntry[]` (the entries at load), `coreThemeTokens: Readonly<Record<string, TokenKind>>`,
  and the fields it has today (`files`, `folder`, `platform`, `homeDir`, `appInstance`, `runMode`, `log`).
- `src/shared/plugin-manifests.ts`:
  `export function withoutUndeclaredDefaults(defaults: DefaultKeymap, commands: Readonly<Record<CommandId, CommandInfo>>, scopes: readonly ScopeInfo[]): { keymap: DefaultKeymap; dropped: string[] }`.
- `UserConfigDeps` no longer extends `ConfigCheckDeps`: it keeps `files`, `folder`, `store`, `settingInfo`,
  `applied`, and reads `store.checks()` at each call.

Decisions:
- **Push, not pull.** The store does not read the catalog. The switch (task 10) hands it the entries with
  `setPlugins`, so the switch decides when the served config sees a change (before or after a part starts). A file
  rebuild between two `setPlugins` calls uses the last admitted entries. The brief's `pluginsChanged()` is this
  `setPlugins`.
- **A user plugin never fails the load.** `loadConfigStore` still rejects for a built-in bug (as today). A user
  entry's bug is an admission problem instead.
- **Admission**, on load and on each `setPlugins`, in this order:
  1. Take every entry with origin `built-in`. Build the schema over them (the checks `configSchema` and
     `requireUnambiguousKeymap` make, and `pluginThemeTokens`). On the first read, a throw here rejects the load (an
     app bug, as today). After the load, a throw fails that rebuild only: `requestRebuild` logs
     `config not read: <error text>` under source `config`, as it does today, the store keeps its last admitted
     entries, and `setPlugins` resolves. A running app never stops on a config change.
  2. Add each other entry in catalog order. Build the schema over the admitted entries plus this one. On a throw,
     record `{ id, message: <error text> }`, then try the store's last admitted entry for that id (if it holds one).
     Admit it if the schema builds; else leave the id out.
     - A replacement of a built-in that is refused when the store holds no admitted entry for the id (on the load, or
       the first `setPlugins` that hands it) is left out with its dependents. The built-in does not come back: a
       replacement is the whole plugin, and the catalog does not hand the hidden built-in entry. The user fixes the
       replacement or deletes its folder. When the store held the built-in entry before (a replacement that arrives
       while the app runs), that built-in entry is the last admitted entry and stays admitted.
  3. Leave out each entry whose `dependsOn.main` or `dependsOn.page` names an id not admitted, repeated until nothing
     more leaves. Record `{ id, message: 'needs plugin "<dep>", which is not loaded' }` (the catalog's wording, task
     08).
  4. The admitted entries keep catalog order. `plugins()` returns them. `AppConfig.plugins` maps each to
     `{ id: entry.manifest.id, origin, revision, pageUrl, manifest: entry.manifest }` (`ServedPlugin` carries
     `manifest`, a seam change the lead accepted from task 11).
- **Snapshot deps.** Each rebuild builds one `ConfigCheckDeps` from the admitted manifests: `manifests` = the admitted
  manifests; `themeTokens` = `{ core: coreThemeTokens, plugins: pluginThemeTokens(coreThemeTokens, manifests) }`;
  `defaultKeymap` = `withoutUndeclaredDefaults(deps.defaultKeymap, commandInfos(coreCommands, manifests), scopeInfos(coreScopes, manifests)).keymap`.
  `fixed` becomes a value the store recomputes on admission, not a `const` at load.
- **Kept settings slice over a new schema.** `settingsSlice` returns `slices.settings` when `settings.json` is broken
  or its check throws. After an admission changes the admitted ids, the kept slice is re-based on the new schema:
  each admitted plugin with no section in `slices.settings.pluginSettings` gets `fixed.pluginDefaults[id]`, and each
  section of an id that is no longer admitted leaves. The user values of every other section stay. So
  `current().pluginSettings[id]` exists for every admitted plugin, also while `settings.json` is broken.
- **Replaced built-in keys.** `withoutUndeclaredDefaults` drops each bind of `defaults` (`binds`, `app`,
  `intercept`, `global`) whose command `commands` does not hold, or whose `scope` (page binds only, `any` kept)
  `scopes` does not hold. One line per dropped bind:
  - `default bind <keys> of <command> dropped: its plugin declares no such command`
  - `default bind <keys> of <command> dropped: its plugin declares no scope <scope>`
  `<keys>` is the bind's `keys`, an accelerator's `accelerator`, or `interceptChordText(bind)`. The store keeps the
  last admission's `dropped` lines and logs them through `logNewDrops` (below), so each logs once.
- **One drop list per rebuild.** `logNewDrops` replaces its set of logged lines on each call, so `rebuild` calls it
  once, as today, with every drop line of that rebuild in one list, in this order: `checked.dropped` (it now also
  holds the keymap's `kept and ignored` lines), `declaredTwice`, the settings slice's `ignored` lines, then the last
  admission's `withoutUndeclaredDefaults` lines. No other code calls `logNewDrops`.
- **Absent plugins' settings are kept and ignored.** In `mergeUserSettings`, a top-level key of `settings.json` that
  is not a core setting and no admitted plugin's id is ignored, with no problem, when the key matches
  `/^[a-z0-9-]+$/` and its value is a JSON object. Any other unknown key stays the problem `"<key>" is not a
  setting.`, so a typo of a core scalar setting still shows. Each ignored key gives the drop line
  `settings.json "<key>" names no loaded plugin; kept and ignored`, logged once through `logNewDrops`.
  `mergeUserSettings` returns the ignored keys (`ignored: string[]` on `UserSettings`); the settings slice carries
  them to `rebuild`'s one `logNewDrops` call. The file is never rewritten without them: Settings writes its own
  layer from the raw file text.
- **Absent plugins' binds are kept and ignored.** In `parseUserKeymap` and `heldBackUserBinds`, a bind or unbind entry
  is ignored, with no problem, when its command or its scope is not a known one and the text before the first `.` is
  no admitted plugin's id and not `core`. Its drop line is
  `keymap.json <path> names plugin "<prefix>", which is not loaded; kept and ignored`, `<path>` as the problems name
  it (`binds[3]`). A known prefix keeps today's problems (`names no scope`, `names no command`).
  The admitted ids reach the parse through `KeymapNames` (add `plugins: readonly string[]`).
  - Accepted change: a typo in a keymap command or scope prefix (`chta.send`) now gives only the drop line and no
    problem, because the store cannot tell a typo from a plugin that is not loaded. A typo of a known prefix
    (`chat.sned`) still shows a problem. This follows plan.md's Decision "Settings and binds under a plugin that is
    not loaded are kept and ignored".
- **A loaded plugin's unknown setting stays a problem**, as today.
- **Served problems order:** the watch problem, the plugins-list problem, the file problems (as today), then
  `setPluginProblems`' list in its order, then `pluginProblems()` in catalog order. Each plugin problem serves as
  `{ file: 'plugins/<id>', message }`. A problem from `setPluginProblems` never changes admission: an id can be
  admitted and have a served problem at once (a last good entry after a failed load, or a built-in entry shown in
  place of a held-back replacement, task 08).
- **user-config follows the store.** `createUserConfig` builds nothing at creation. `schema()`, `read()` and every
  write call `store.checks()` and build the user schema from it, so Settings sees a plugin that arrived. It still
  throws at the first `schema()` on a built-in `settingInfo` bug.

GIVEN a user entry whose command id is a core command's (`modes.show`) WHEN the store loads THEN the load resolves,
the entry is left out, and `pluginProblems()` holds `{ id: 'modes', message: 'Command "modes.show" is declared twice' }`
GIVEN entry `x` admitted at revision 1 WHEN `setPlugins` hands `x` at revision 2 whose theme token clashes THEN
`plugins()` holds `x` at revision 1 and `pluginProblems()` names `x`
GIVEN a user plugin `b` depending on `a`, and `a` refused WHEN admitted THEN `b` is left out with
`needs plugin "a", which is not loaded`
GIVEN a default bind of `chat.send` and an admitted `chat` that declares no `send` WHEN the store rebuilds THEN the
served keymap holds no bind of `chat.send` and the log holds
`default bind <keys> of chat.send dropped: its plugin declares no such command` once
GIVEN `settings.json` holds `"gone": { "x": 1 }` and no plugin `gone` WHEN the store loads THEN no problem is served
and the log holds `settings.json "gone" names no loaded plugin; kept and ignored`
GIVEN `keymap.json` binds a key to `gone.run` in scope `gone.main` WHEN the store loads THEN no problem is served, the
bind is not in the keymap, and the other binds apply
GIVEN `setPlugins` adds plugin `p` with a setting WHEN it resolves THEN `current().pluginSettings.p` holds its default,
`current().plugins` lists `p`, and `userConfig.schema()` lists `p`'s section
GIVEN a broken `settings.json` WHEN `setPlugins` adds plugin `p` with a setting THEN `current().pluginSettings.p` holds
its default and the other sections keep their last good user values
GIVEN a user plugin `chat` that replaces the built-in and a command clash WHEN the store loads THEN `plugins()` holds no
`chat` entry and no entry that depends on `chat`, and `pluginProblems()` names `chat`
GIVEN a built-in whose schema throws after the load WHEN `setPlugins` runs THEN it resolves, `plugins()` is unchanged,
and the log holds `config not read: <error>`

Tests (one test per behaviour, cases as rows; the existing `load(files, { manifests })` helper builds built-in entries
from `manifests`, and a `userEntry(manifest, revision)` helper builds a user one):
- `config-store.test.ts`, new `admission_UserEntry_LeftOutWithAProblem` — rows: core command id clash
  (`modes.show`, problem `Command "modes.show" is declared twice`); theme token sharing a built-in's CSS variable;
  settings under a core setting name; default key clash with a built-in's key; a dependent of a refused entry
  (`needs plugin "a", which is not loaded`). Each asserts the load resolves, `plugins()` ids, and
  `pluginProblems()`. Breaks if a user bug fails the load or a refused entry is served.
- `config-store.test.ts`, new `setPlugins_RefusedNewRevision_KeepsTheLastAdmitted` — `plugins()` holds revision 1
  and the problem names the id. Breaks if a bad reload drops the running version's config. Task 10 reads this
  result to learn the refusal.
- `config-store.test.ts`, add a row to `admission_UserEntry_LeftOutWithAProblem`: a replacement of built-in `a`
  with a clash, and a built-in `b` that depends on `a`, on the load. `plugins()` holds neither `a` nor `b`.
- `config-store.test.ts`, new `setPlugins_RebuildThrows_ResolvesAndKeepsTheAdmitted` — a manifest fake whose schema
  build throws after the load; `setPlugins` resolves, `plugins()` is unchanged, the log holds `config not read:`.
  Breaks if a config change can reject into the switch.
- `config-store.test.ts`, new `setPlugins_BrokenSettings_RebasesTheKeptSlice` — rows: add `p` (its defaults appear,
  `q`'s user value stays); remove `q` (its section leaves). Breaks if a new plugin reads an undefined section.
- `config-store.test.ts`, new `drops_EveryProducer_LoggedOncePerLine` — one rebuild with a default-bind drop, an
  ignored settings key and an ignored keymap bind; a second rebuild with no file change logs nothing new. Breaks if
  one producer's call wipes another's logged set.
- `config-store.test.ts`, new `setPlugins_AddsAndRemoves_ServesSchemaAndPlugins` — rows: add (command, setting,
  theme token and `AppConfig.plugins` row appear), remove (all four leave). Breaks if the schema stays frozen at load.
- `config-store.test.ts`, new `setPlugins_DuringAFileRebuild_RunsAfterIt` — a held file read; `setPlugins` resolves
  after the queued rebuild publishes. Breaks if the two rebuilds race.
- `config-store.test.ts`, add rows to the existing `rejects a plugin layer with a clash inside it` and
  `configSchema_DefaultBindBadArg_Throws`: each still rejects the load for a built-in.
- `config-store.test.ts`, new `setPluginProblems_ServedAfterFileProblems` — order and `file: 'plugins/<id>'`.
  Breaks if a plugin problem hides a file problem or lacks its file.
- `config-store.test.ts`, new `absentPlugin_SettingsAndBinds_KeptAndIgnored` — rows: a settings object under an
  absent id (no problem, drop line); a scalar under an unknown key (problem `"zz" is not a setting.`); a bind to an
  absent plugin's command; a bind in an absent plugin's scope; an unbind in an absent plugin's scope; a bind to an
  unknown command of a loaded plugin (today's held-back problem stays). Breaks if a deleted plugin sticks the config.
- `plugin-manifests.test.ts`, new `withoutUndeclaredDefaults_DropsWhatNoPluginDeclares` — rows: page bind with an
  undeclared command; app accelerator with an undeclared command; page bind in an undeclared scope; bind in `any`
  kept; core command kept. Asserts the kept keymap and each `dropped` line verbatim.
- `user-settings.test.ts`, row added for the ignored object key and the `ignored` list.
- `user-keymap.test.ts`, add a row to `parseUserKeymap_UnknownCommand_KeepsTheBind` for an absent plugin's scope
  (no throw), and to `heldBackUserBinds_UnknownWrongProcessBadArg_DropsWithPathInText` for an absent plugin's command
  (no problem).
- `user-config.test.ts`, new `schema_AfterSetPlugins_ListsTheNewPlugin`. Breaks if user-config keeps a load-time
  schema.

Approach: the admission loop builds the schema once per user entry; with a handful of user plugins that is cheap, so
no caching beyond `fixed`.

Done when: compiles; `npm run typecheck` passes; the tests above pass.
Commit:    one commit for the group.

## Proof
