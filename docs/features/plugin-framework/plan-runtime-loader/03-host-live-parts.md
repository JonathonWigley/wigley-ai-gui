# 03 — Host adds and removes parts

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/shared/plugin-host.ts` · test `src/shared/plugin-host.test.ts`
Consumes:  none (the members below are in the tree)
Produces:  in `src/shared/plugin-host.ts`:
           ```ts
           export interface PluginHost<Started, Part = unknown> {
             // … every member it has now, unchanged …
             // Adds a part the host did not hold. Starts nothing. Throws on an id the host holds.
             add(part: Part): void;
             // Stops the part and its dependents, as `stop` does, then forgets the part.
             // Resolves to the ids it stopped. Resolves to [] for an id the host does not hold.
             remove(pluginId: string): Promise<string[]>;
           }
           ```
           `startPlugins` returns `PluginHost<Started, Part>`. Its `known` parameter becomes
           `known: readonly PluginManifest[] | (() => readonly PluginManifest[])`; its default is a function that
           returns the manifests of the parts the host holds now.

Decisions:
- The host has no `reload` member. Task 10 swaps a main part as `remove`, `add`, then `start` of every id `remove`
  returned, so that when the new code fails to start it can put the last good part back the same way. Task 11 swaps a
  page part the same way. A `reload` member would have no caller.
- The parts list becomes live. The host keeps `held: Part[]`, a copy of `parts`. `add` appends to its end. `remove`
  deletes the part from it. `partIds` is read from `held` at each check, not fixed at construction.
- `known` becomes live. Each check reads `known` at the time of the check: the array as given, or the function's
  result. Main (task 13) passes `() => store.plugins().map((entry) => entry.manifest)`, the entries the config admitted; the page passes what task 11 gives it. A dependency is
  known when `known` holds its manifest or `held` holds its part.
- `start(ids)` gains one check. It runs after the `Plugin host is stopping` check and before
  `requireDependenciesStarting`, and throws before it starts anything. It covers only the candidates: the named
  parts in `held` that are not started. A candidate whose `dependsOn[process]` names an id that is not known throws
  `Plugin "<id>" depends on plugins not in the list: <ids>` (the text `requireDependenciesListed` throws now; call it
  over the candidates' manifests). A named part that is already started is not checked, so a `start` of a running
  part stays a no-op after its dependency is removed. So a dependent of a removed part does not start with
  `dependency()` returning `undefined`.
- `add` checks the new part synchronously before the host changes anything, in this order, and throws:
  1. After `stopAll` began: `Plugin host is stopping`.
  2. `held` holds the id → `Two plugins have the id "<id>"` (the `requireUniqueIds` text).
  3. Each `dependsOn[process]` id of the new part is known → else the `requireDependenciesListed` text.
  4. No cycle: over a copy of the would-be `held` list (`held` plus the new part), call `nextToStart` and remove the
     part it returns, until the copy is empty. This starts nothing. `nextToStart` throws
     `Plugins depend on each other in a cycle: <ids>`; let that error out. The walk covers disabled parts on purpose:
     `held` keeps them, and a later `start` can bring one up. (Construction checks cycles only over the kept parts.
     The catalog's `dependencyOrder` refuses a cycle over every plugin, so a held list with a cycle among disabled
     parts does not occur in the app.)
- `remove(pluginId)`:
  1. `held` does not hold the id → resolve `[]`.
  2. `ids = await stop(pluginId)`: dependents first, then the part. It works after `stopAll` began, as `stop` does.
  3. Delete the part from `held` after the stop settles, also when the stop rejected; then reject with the stop's
     first error, or resolve to `ids`.
  The dependents stay in `held`, stopped. A later `start` of one of them throws the not-in-the-list text above,
  unless `known` still names the removed id.
- `add(part)` starts nothing and calls no `ready`. The caller calls `start([id])`.
- The construction checks (`requireUniqueIds`, `requireDependenciesListed`, `disabledDependencyProblem`, the
  first start) run as now, over `parts` and `known` read once. `disabled` is still read only at construction.
- Update the doc comments of `PluginHost` and `startPlugins`: the parts list and `known` are live; `add` and `remove` follow
  the rules above. Remove the sentence on `known` being fixed, if a comment says so.
- `src/renderer/plugin-parts-answer.ts` types its host as `Pick<PluginHost<unknown>, …>`; it compiles unchanged
  with the `Part = unknown` default. Do not edit it here (task 04 and task 11 own it).

GIVEN a host over `a` and `b` WHEN `remove('a')` runs THEN `b` and `a` stop, it resolves `['b', 'a']`, and a later
`start(['b'])` throws the not-in-the-list text.

Tests:     rows and tests in `src/shared/plugin-host.test.ts`, using its `part`, `startLogging` and `startHooked` helpers.
           Build each host with `startPlugins` and no `known`, unless the row is about `known`.
           - `add holds a part that a later start brings up` — `add(part('c', ['a']))` on a host over `a`, then
             `start(['c'])`; asserts `c` is started after `a` and got `ready`, and nothing started at `add`. Catches:
             `add` that starts the part; a `held` list `start` does not read.
           - `add refuses a part, changing nothing` — `it.each` rows, each `{ name, run, error }` on a host
             over `a` and `b` (b depends on a), both started:
             add of an id the host holds → `Two plugins have the id "a"`;
             add of `part('c', ['zzz'])` → `depends on plugins not in the list: zzz`;
             add of `part('c', ['x'])` on a host built from parts `a`, `b` and `x`, with `disabled: ['x']`, `x`
             depending on `c`, and `known` holding the manifests of `a`, `b`, `x` and `c` → `cycle` (this row's
             host is not the shared one);
             add after `stopAll` began → `Plugin host is stopping`.
             Asserts the throw holds `error`, `started` keys are unchanged, and the dispose log is empty.
             Catches: a check that runs after the stop; a missing check.
           - `remove stops the part with its dependents and forgets it` — `it.each` rows:
             `{ remove: 'a', stopped: ['b', 'a'] }` on a host over `a` and `b` (on a), and
             `{ remove: 'zzz', stopped: [] }`. Asserts the resolved ids; for `a`, `start(['a'])` then starts nothing
             and `start(['b'])` throws `depends on plugins not in the list: a`. Catches: a remove that leaves the part
             held; one that skips dependents.
           - `start checks only the parts it would start` — `known` is a function over a `let` array holding the
             manifests of `b` (on `p`), `c` (on `p`) and `p` (a manifest with no part here); a host over parts `b`
             and `c`, with `disabled: ['c']`, so `b` starts. Take `p` out of the array. Asserts `start(['b'])` does
             not throw and starts nothing new (`b` started once), and `start(['c'])` throws
             `depends on plugins not in the list: p` and starts nothing. Catches: the check run over every named
             part, which throws on a running one.
           - turn the existing `'restart rejects and starts nothing when its stop rejects'` into an `it.each` over
             `restart` and `remove`, each on a part whose `dispose` throws: each rejects with that error and
             starts nothing; for `remove`, a later `start` starts nothing. Catches: a forget skipped on a rejected stop.
           - `known as a function is read at each check` — `startPlugins([part('a')], 'main', start, () => known)`
             with `known` a `let` array of `a`'s manifest; `add(part('b', ['p']))` throws; push a manifest with id `p`
             (no part here) to `known`; the same `add` now passes and `start(['b'])` starts `b`. Catches: `known` read
             once at construction.
Done when: `npm test -- src/shared/plugin-host.test.ts src/renderer/plugin-parts-answer.test.ts src/plugins/page.test.ts`
           passes; `npm run typecheck` passes.
Commit:    one commit for the group

## Proof
