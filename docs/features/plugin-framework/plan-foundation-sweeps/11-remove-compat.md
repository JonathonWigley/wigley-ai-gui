# 11 — Remove the compatibility forms

Status: in progress
Type: Task
Wave: 7 · Depends on: 08, 09, 10
Plan: [plan.md](plan.md)

Files:     modify `src/contracts/plugin.ts` · `src/contracts/log.ts` · `src/main/plugins/main-api.ts` ·
           `src/renderer/plugins/page-api.ts` · `src/shared/plugin-log.ts` ·
           test `src/shared/plugin-log.test.ts` · create `src/shared/plugin-log.test-d.ts` · `src/shared/define-plugin.test-d.ts`
           (the `dependency(key)` type test task 01 adds) · `src/main/plugins/main-api.test.ts` ·
           `src/renderer/plugins/page-api.test.ts` (the `dependency` row of task 01)
Consumes:  `dependency<E, Id extends M['dependsOn'][P][number]>(key: DependencyKey<E, P, Id>): E` on `MainApi` and `PageApi` ← 01
           the deprecated `dependency<E>(pluginId: string): E` overloads on `MainApi` and `PageApi` ← 01
           `PluginLog` with its deprecated `(source: string, message: string): void` signature in `src/contracts/log.ts` ← 04
           `pluginLog(log: Log, pluginId: string): PluginLog` in `src/shared/plugin-log.ts` ← 04
           every plugin call moved to `api.dependency(<id>XKey)` and `log(message)` ← 08, 09, 10
Produces:  in `src/contracts/log.ts`: `export type PluginLog = (message: string) => void;`
           in `src/contracts/plugin.ts`: `MainApi.dependency` and `PageApi.dependency` with the key signature alone
           in `src/shared/plugin-log.ts`: `pluginLog` returning `(message) => log(pluginId, message)`
Decisions: the core waves keep the old call forms compiling while the plugin tasks move each plugin, and task 11
           removes them (plan.md § Compatibility forms) · `api.dependency(key)` fails to compile on the wrong process
           or an undeclared id (round 2) · `services.log` is called as `log(message)` (round 2)
GIVEN the plugin tasks have moved every call WHEN the two deprecated forms are removed THEN the tree compiles, and a
      string-id `dependency` call or a two-argument plugin log call fails to compile
Tests:     `plugin-log.test-d.ts` — `types a plugin log so a source argument fails to compile`: `assertType<PluginLog>`
           of a one-argument call compiles; `// @ts-expect-error -- a plugin log takes no source` above
           `log('p', 'hello')`
           `define-plugin.test-d.ts`, the `dependency(key)` type test from 01 — a new row `// @ts-expect-error -- a plugin id
           string is no key` above `api.dependency('sessions')`; the line `assertType<{ n: number }>(pageApi.dependency<{ n:
           number }>('a'))` (the deprecated overload) is deleted
           `main-api.test.ts` and `page-api.test.ts` — the `it.each` of 01 (`dependency asks the host for the plugin $name
           names`) loses its `{ name: 'an id', arg: 'a' }` row and keeps the `a key` row; task 01's rows are the only
           string-id rows in these files
           `plugin-log.test.ts` — the `it.each` from 04 loses its two-argument row and becomes
           `it('logs a plugin's line under its id')`: `pluginLog(log, 'p')('hello')` logs `[['p', 'hello']]`
Approach:  Run the first three greps below before the edit; each must print nothing (exit 1). A line printed is a caller
           a plugin task left: stop and report it, since a plugin folder belongs to task 08, 09 or 10. The fourth grep
           matches the deprecation markers that tasks 01 and 04 wrote, so it prints lines before the edit: run it after
           the edit, where it must print nothing. Task 07's harness takes a key only (07 says so), so no harness file
           is in this task's Files.
           ```
           grep -rnE "\.dependency(<[^>]*>)?\('" src/plugins --include='*.ts'
           grep -rnE "\blog\(\s*('[a-z-]+'|[A-Z_]+|[a-zA-Z]+Manifest\.id),\s" src/plugins --include='*.ts'
           grep -rnE -A1 "\blog\($" src/plugins --include='*.ts' | grep -E "^[^:]+-[0-9]+-\s*('[a-z-]+'|[A-Z_]+|[a-zA-Z]+Manifest\.id),$"
           grep -rn "removed by plan task 11" src
           ```
           The first finds a string-id `dependency` call, with or without a type argument. The second finds a
           two-argument log call on one line whose source is a literal, a constant (`SOURCE`, `PLUGIN_ID`) or a
           manifest id (`sessionsManifest.id`); the third finds one whose source sits on the line after `log(`. The
           fourth finds every deprecation marker left. After the edit, the fourth grep must print nothing, and
           `npm run typecheck` is the binding proof: a two-argument call to a `PluginLog` or a string passed to
           `dependency` that the greps missed fails to compile. A failure in a plugin folder is a caller a plugin task
           left: report it rather than fix it here.
           `MainApi.dependency` and `PageApi.dependency` lose the overload and its `@deprecated` comment; the
           implementations in `createMainApi` and `createPageApi` drop the string branch and read `key.id`.
           `PartContext.dependency(pluginId: string): unknown` in `src/shared/plugin-host.ts` keeps its string: the
           APIs pass it `key.id`.
           `PluginLog` becomes the type alias; `pluginLog` drops its two-argument branch.
Done when: compiles (`npm run typecheck`); the four greps print nothing; `grep -rln "type { Log }\|type Log\b" src/plugins`
           prints nothing (a plugin helper still typed `Log` accepts a `PluginLog` and would log its source as the
           message: report each file left as a caller a plugin task missed); the test gate runs the tests above;
           `npm run lint` passes
Commit:    one commit for the group

## Proof

