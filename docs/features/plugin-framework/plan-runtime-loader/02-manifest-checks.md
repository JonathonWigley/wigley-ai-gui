# 02 — Manifest checks and schema

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     create `src/shared/plugin-catalog/validate-manifest.ts`, `src/shared/plugin-catalog/manifest-schema.ts` ·
           test `src/shared/plugin-catalog/validate-manifest.test.ts`, `src/shared/plugin-catalog/manifest-schema.test.ts` ·
           modify `src/shared/define-plugin.ts` · test `src/shared/define-plugin.test.ts` (unchanged rows must still pass) ·
           modify `src/main/layouts/layout-service.ts` (one line) · test `src/main/layouts/layout-service.test.ts`
           (unchanged, must pass)
Consumes:  the `'src/shared/plugin-catalog'` layer ← 01 (the lint passes only after 01; the tests run without it)
           `requireDeclaredScope`, `pluginOptionalSettings`, `pluginSettingInfo`, `pluginThemeTokens` in
           `src/shared/plugin-manifests.ts` (in the tree) · `isJsonObject` in `src/shared/json.ts` · `errorText` in
           `src/shared/error-text.ts`
Produces:  in `src/shared/plugin-catalog/validate-manifest.ts`:
           ```ts
           export type ManifestCheck =
             | { readonly ok: true; readonly manifest: PluginManifest }
             | { readonly ok: false; readonly problems: readonly string[] };
           export const SHORT_ID_PATTERN = '^[A-Za-z][A-Za-z0-9]*$';
           export function validateManifest(raw: unknown): ManifestCheck;
           export function handlerProblems(
             manifest: PluginManifest,
             process: ProcessName,
             commands: object,
           ): string[];
           ```
           in `src/shared/plugin-catalog/manifest-schema.ts`: `export const manifestSchema: object`
           in `src/shared/define-plugin.ts`: `export const PLUGIN_ID_PATTERN = '^[a-z0-9-]+$';` and
           `export function pluginIdProblem(id: string): string | null`

Decisions:
- One source for the id rule. `define-plugin.ts` exports `PLUGIN_ID_PATTERN` and `pluginIdProblem`. `pluginIdProblem`
  returns `Plugin id "<id>" must be lowercase letters, digits and -` when the pattern fails, `Plugin id "core" is
  reserved for the core` for `core`, else null. `definePlugin` throws `new Error(pluginIdProblem(id))` when it is not
  null, so its thrown texts do not change. `validateManifest` and `manifestSchema` use the same two names. The pattern
  has no `_`, so an id cannot begin with `_` and `plugins/_types/` is never a plugin; add no separate `_` check.
- `define-plugin.ts` builds its `PLUGIN_ID` regex from `PLUGIN_ID_PATTERN`. `src/main/layouts/layout-service.ts`
  holds a third copy of the rule, `const OWNER = /^[a-z0-9-]+$/` (line 55). Change that line to
  `new RegExp(PLUGIN_ID_PATTERN)`, imported from `src/shared/define-plugin.ts` (the `src/main/layouts` layer
  already imports `src/shared`). Keep the test as `OWNER.test(owner)`, not `pluginIdProblem`: the layout owner `core`
  is valid, and `pluginIdProblem` refuses it. Keep the comment above it. Task 11 edits this file later; it keeps
  this line.
- Short ids. A key of `commands` and a key of `scopes` is a short id: the registry and the keymap qualify it as
  `<pluginId>.<short>`, and a reader splits a qualified id at its first `.`. The rule is
  `SHORT_ID_PATTERN = '^[A-Za-z][A-Za-z0-9]*$'` (a letter, then letters and digits; every built-in short id is camel
  case and passes). `validate-manifest.ts` exports it, and the schema reads it as `propertyNames`
  of `commands` and `scopes`. The scope short id `any` is refused, since a bind's `scope: 'any'` means every scope.
  `definePlugin` does not get this check: TypeScript cannot state it, and the built-ins pass it.
- `validateManifest` runs at load the checks `definePlugin`'s types make at compile time, and the runtime checks that
  matter for one manifest. It never throws. It returns every problem it finds, in the order of the table below.
- Two passes. Pass 1 checks the shape of every field and collects every problem. Pass 2 runs only when pass 1 found
  none: it calls the existing checks in `plugin-manifests.ts` on `[manifest]`, each in its own try/catch, and adds each
  thrown `errorText(error)` as a problem. Pass 2 never copies their logic. The calls:
  - `requireDeclaredScope(manifest, scope)` for each `keys.binds` scope that is not `'any'`.
  - `pluginOptionalSettings([manifest])` — a null default with no declared kind, a declared kind for a valued default.
  - `pluginSettingInfo([manifest])` — `settingInfo` keys equal the settings' leaf paths.
  - `pluginThemeTokens({}, [manifest])` — token names. The empty core map is on purpose: a clash with a core token or
    another plugin's token is a cross-plugin check, made where the served config is built (task 09).
- Cross-plugin checks stay out: an unknown dependency, a dependency cycle, a duplicate id, a setting under a core
  setting's name (`requireNoSettingsUnderCoreNames`), and the syntax of chords and accelerators (the keymap merge
  checks them). The catalog (task 08), the host (task 03) and the config (task 09) own them.
- `$schema`. A `manifest.json` may hold a top-level `"$schema"` string, so an editor finds `../_types/manifest.schema.json`.
  `validateManifest` accepts it and leaves it out of the returned manifest. Any other unknown field is a problem.
- The returned `manifest` is a new object with only the `PluginManifest` fields, `keys` and `optionalSettings` left
  out when the raw manifest has none.
- `handlerProblems`: a handler is an own property of `commands` whose value is a function. First `missing <short>` for
  each command the manifest declares with `runsIn === process` and no handler, in declaration order. Then
  `undeclared <short>` for each own key of `commands` that names no command declared with `runsIn === process`, in key
  order; a handler for a command of the other process is `undeclared`. `<short>` is the short id, since the plugin's
  row already names the plugin. The caller is the switch, after a start (task 10).
- `manifestSchema` is JSON Schema draft 2020-12 (`"$schema": "https://json-schema.org/draft/2020-12/schema"`), title
  `Wigley plugin manifest`. It states what a schema can state: the required fields (`id`, `label`, `description`,
  `dependsOn`, `reads`, `commands`, `scopes`, `settings`, `settingInfo`, `themeTokens`), `additionalProperties: false`
  wherever the table below rejects an unknown field, the id `pattern` (`PLUGIN_ID_PATTERN`) with `not: { const: 'core' }`,
  the `runsIn`, `arg`, `where`, `mode`, `kind` and setting kind enums, and `propertyNames: { pattern: SHORT_ID_PATTERN }`
  on `commands` and `scopes` (with `not: { const: 'any' }` on `scopes`). It leaves to `validateManifest` what it cannot
  state: a bind naming a declared command, leaf paths, null defaults. Task 07 writes it to `plugins/_types/`.

Problems, in check order. `<…>` is the value or key found. Each row is pass 1 unless marked.

| Field | Rule | Problem text |
|---|---|---|
| whole | a JSON object (`isJsonObject`) | `manifest must be a JSON object` (no other check runs) |
| any top-level key | one of the `PluginManifest` fields or `$schema` | `unknown field "<key>"` |
| `$schema` | a string when present | `$schema must be a string` |
| `id` | a string | `id must be a string` |
| `id` | `pluginIdProblem(id)` is null | that problem's text |
| `label`, `description` | a string | `<field> must be a string` |
| `dependsOn`, `reads` | an object | `<field> must be an object with main and page` (no other check of that field runs) |
| `dependsOn`, `reads` | only the keys `main` and `page` | `<field> has unknown field "<key>"` |
| `dependsOn`, `reads` | `main` and `page` each an array of strings (a missing key fails too) | `<field>.<process> must be an array of strings` |
| `dependsOn`, `reads` | no list names the plugin's own id | `<field>.<process> names the plugin itself` |
| `commands` | an object | `commands must be an object` (no command check runs) |
| each command key | matches `SHORT_ID_PATTERN` | `command "<short>" id must be a letter, then letters and digits` |
| each command | an object | `command "<short>" must be an object` (no other check of that command runs) |
| each command | `label` string, `group` string, `runsIn` `'main'` or `'page'`, optional `arg`; no other field | `command "<short>" label must be a string` · `command "<short>" group must be a string` · `command "<short>" runsIn must be "main" or "page"` · `command "<short>" has unknown field "<key>"` |
| command `arg` | `'number'`, `'string'`, or an object whose every value is `'number'` or `'string'` | `command "<short>" arg must be "number", "string" or an object of those` |
| `scopes` | an object | `scopes must be an object` (no scope check runs) |
| each scope key | matches `SHORT_ID_PATTERN`, and is not `any` | `scope "<short>" id must be a letter, then letters and digits` · `scope "any" is reserved for binds that act in every scope` |
| each scope | a string title | `scope "<short>" title must be a string` |
| `keys` | absent, or an object | `keys must be an object` (no `keys` check runs) |
| `keys` | only `binds`, `groups`, `app`, `global`, `intercept` | `keys has unknown field "<key>"` |
| `keys.groups` | absent, or an object whose values are strings | `keys.groups must be an object` · `keys.groups "<key>" must be a string` |
| `keys.<list>` | each of `binds`, `app`, `global`, `intercept` absent, or an array | `keys.<list> must be an array` (no check of its items runs) |
| `keys.<list>[i]` | an object | `keys.<list>[<i>] must be an object` (no other check of that item runs) |
| `keys.<list>[i]` field | only the fields its kind allows (the next three rows) | `keys.<list>[<i>] has unknown field "<key>"` |
| `keys.binds[i]` | `keys` string, `scope` string, `command` string, optional `where`, `mode`, `arg` | `keys.binds[<i>] <field> must be a string` (for `keys`, `scope`, `command`) · `keys.binds[<i>] where must be "page", "box" or "both"` · `keys.binds[<i>] mode must be "normal" or "insert"` |
| `keys.binds[i].command` | a declared command with `runsIn: 'page'` | `keys.binds[<i>] command "<c>" is not a declared command` · `keys.binds[<i>] command "<c>" runs in main; bind it under keys.app, keys.global or keys.intercept` |
| `keys.app[i]`, `keys.global[i]` | `accelerator` string, `command` string, optional `arg` | `keys.<list>[<i>] <field> must be a string` (for `accelerator`, `command`) |
| `keys.intercept[i]` | `key` string, `command` string, optional `control`, `alt`, `shift`, `meta`, optional `arg` | `keys.intercept[<i>] <field> must be a string` (for `key`, `command`) · `keys.intercept[<i>] <field> must be a boolean` (for `control`, `alt`, `shift`, `meta`) |
| `keys.app/global/intercept[i].command` | a declared command with `runsIn: 'main'` | `keys.<list>[<i>] command "<c>" is not a declared command` · `keys.<list>[<i>] command "<c>" runs in the page; bind it under keys.binds` |
| any bind `arg` | a number, a string, or an object whose values are numbers or strings | `keys.<list>[<i>] arg must be a number, a string or an object of those` |
| `settings` | an object; every value under it null, a boolean, a finite number, a string, an array or an object of these | `settings must be an object` · `settings.<path> is not a JSON value` |
| `optionalSettings` | absent, or an object whose values are `'string'`, `'number'` or `'boolean'` | `optionalSettings must be an object` · `optionalSettings "<path>" must be "string", "number" or "boolean"` |
| `settingInfo` | an object; each value an object with `label` string and `description` string, no other field | `settingInfo must be an object` · `settingInfo "<path>" must have a label and a description` (also for a value that is not an object, or has another field) |
| `themeTokens` | an object | `themeTokens must be an object` (no token check runs) |
| each theme token | an object with `kind` one of `color`, `length`, `duration`, `number`, `shadow`, `filter`, `raw` and `default` a string, no other field | `theme token "<key>" must be an object` · `theme token "<key>" kind must be one of color, length, duration, number, shadow, filter, raw` · `theme token "<key>" default must be a string` · `theme token "<key>" has unknown field "<field>"` |
| pass 2 | `requireDeclaredScope` per bind scope not `'any'` | its thrown text: `Plugin "<id>" declares no scope "<scope>"` |
| pass 2 | `pluginOptionalSettings([m])` | its thrown text |
| pass 2 | `pluginSettingInfo([m])` | its thrown text |
| pass 2 | `pluginThemeTokens({}, [m])` | its thrown text |

The token kinds list is `TokenKind` in `src/contracts/theme.ts`. `validate-manifest.ts` holds it as a
`const TOKEN_KINDS: readonly TokenKind[]` typed so a kind added to `TokenKind` and missing here fails to compile
(`satisfies` over a `Record<TokenKind, true>`), and the schema reads the same list.

GIVEN a manifest with every field filled, as a built-in declares it WHEN `validateManifest` runs THEN it returns
`ok: true` with a manifest equal to the input minus `$schema`.
GIVEN a manifest with one fault from the table WHEN `validateManifest` runs THEN it returns `ok: false` and a problem
holding the row's text.
GIVEN a manifest with a shape fault and a pass-2 fault WHEN it runs THEN only the shape problem shows.
GIVEN a start's `commands` WHEN `handlerProblems` runs THEN it lists missing handlers, then undeclared ones.

Tests:     `validate-manifest.test.ts`. A `validManifest()` builder in the test returns a manifest with two commands
           (`open` runs in the page with `arg: 'string'`, `sync` runs in main), one scope `list`, one bind of each kind
           (`binds` in scope `list`, `app`, `global`, `intercept`), a nested setting `view.width: 320`, a null setting
           `filter: null` with `optionalSettings: { filter: 'string' }`, `settingInfo` for `view.width` and `filter`, and
           one theme token `accent` of kind `color`, plus `"$schema"`.
           - `accepts a manifest with every field, dropping $schema` — asserts `ok: true` and
             `toEqual(<builder output without $schema>)`. Catches: a valid field rejected; `$schema` kept.
           - `rejects a manifest with each fault, naming it` — `it.each` with one row per problem text in the table
             above (a cell with several texts gives one row for each), each a `validManifest()` with one change and
             the problem text with `<…>` filled in as the substring; for `<i>` use `0` and for `<list>` each list the
             text names. Plus these rows:
             `id: 'My-Plugin'`, `id: 'core'`, `id: '_types'`, `dependsOn.page` naming the own id, a bind naming
             `sync`, an `app` bind naming `open`, a bind naming `nope`, a bind in scope `other`, `filter` dropped
             from `optionalSettings`, `settingInfo` missing `view.width`, `settingInfo` naming `view`, theme token
             `Accent`, `settings.view.width` set to `() => 1` (raw object, not JSON text), the raw value `[]`, a
             command `a.b`, a command `1st`, a scope `any`, and `dependsOn` with `main` left out.
             Asserts `ok: false` and `problems` holds one entry containing the row's substring. Catches: each
             removed check; a pass-2 check not called.
           - `reports every shape problem, and pass 2 only when the shape is right` — two rows: `label: 1` and
             `description: 2` together give two problems; `label: 1` with `filter` dropped from `optionalSettings`
             gives only the label problem. Catches: a validator that stops at the first problem; pass 2 run on a bad
             shape (it would throw a TypeError text).
           - `handlerProblems lists missing then undeclared handlers of a process` — `it.each` rows over the builder's
             manifest: main with `{ sync: fn }` → `[]`; main with `{}` → `['missing sync']`; main with
             `{ sync: fn, open: fn }` → `['undeclared open']`; page with `{ sync: fn }` →
             `['missing open', 'undeclared sync']`; main with `{ sync: 'text' }` → `['missing sync']`. Catches: the
             wrong process, a non-function counted as a handler, the order flipped.
           `manifest-schema.test.ts`:
           - `states the manifest's fields and the id rule` — asserts `Object.keys(manifestSchema.properties)` equals
             the builder's keys (`$schema` included), `required` equals the ten required fields, `properties.id.pattern`
             is `PLUGIN_ID_PATTERN`, the `propertyNames.pattern` of `commands` and `scopes` is `SHORT_ID_PATTERN`, and
             the `themeTokens` kind enum equals `TOKEN_KINDS`. Catches: the schema drifting
             from the validator. (No JSON Schema validator is installed, and none is added.)
           `define-plugin.test.ts`: its three id tests stay as they are and still pass.
Done when: `npm test -- src/shared/plugin-catalog/ src/shared/define-plugin.test.ts src/main/layouts/layout-service.test.ts` passes; `npm run typecheck`
           passes; `npm run lint` passes once 01 has landed.
Commit:    one commit for the group

## Proof

Commit e0fe3448 · proof: diff read; validateManifest, handlerProblems, SHORT_ID_PATTERN, manifestSchema, PLUGIN_ID_PATTERN, pluginIdProblem present; 125 tests pass · concerns: validManifest builder moved to manifest.test-support.ts so the schema test can share it
