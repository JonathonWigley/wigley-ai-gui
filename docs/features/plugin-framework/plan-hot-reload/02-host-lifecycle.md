# 02 — Host starts, stops and restarts live

Status: in progress
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:
- modify `src/shared/plugin-host.ts`
- modify `src/contracts/plugin.ts` (`MainStart` and `PageStart` only)
- test `src/shared/plugin-host.test.ts`

Consumes:
- `startPlugins`, `PartContext`, `stopOrder`, `stopPart`, `nextToStart`, `startWithCleanup` in `src/shared/plugin-host.ts` (the tree holds them).

Produces:
- `MainStart<M>` and `PageStart<M>` in `src/contracts/plugin.ts` each gain these two members, with these comments, word for word from plan.md:
  ```ts
  // Called by the host once every part of this process has started at launch (main) or page load (page),
  // and after a live start, once every part that start brought up has started.
  ready?(): void;
  // A reason the part must not stop now, in words the user reads (a round is open in <session>), or null.
  // The switch asks it before a switch-off; a restart and quit do not ask.
  mayStop?(): string | null;
  ```
- `export interface PluginHost<Started>` in `src/shared/plugin-host.ts`, word for word as plan.md § Plugin host gives it: `started`, `ready(): void`, `start(pluginIds: readonly string[]): void`, `stop(pluginId: string): Promise<string[]>`, `restart(pluginId: string): Promise<string[]>`, `mayStop(pluginIds: readonly string[]): string | null`, `stopping(): readonly string[]`, `stopAll(): Promise<void>`.
- `startPlugins` keeps its signature. Its `Started` constraint gains `ready?(): void` and `mayStop?(): string | null`.
- The thrown text `Plugin "<id>" depends on plugin "<dependency>", which is not started`.
- The log line `[plugin-host] ready of <id> failed: <error text>` (source `plugin-host`, message `ready of <id> failed: <errorText(error)>`).

Decisions:
- **The host keeps every part.** `startPlugins` still starts only the parts `disabled` does not name. It keeps the whole `parts` list, so a later `start(ids)` can start a disabled part. The checks `requireUniqueIds` and `requireDependenciesListed` now run over every part, disabled ones included, since any of them may start later. `disabledDependencyProblem` still runs over the kept parts at `startPlugins`, as today (agent).
- **`start(pluginIds)`.** The candidates are the parts in `parts` whose id `pluginIds` names and that are not started, in `parts` list order. An id with no part in this process is ignored, as `disabled` ignores one today. A started id is skipped.
  - Before it starts any part, it checks each candidate's `dependsOn[process]`. A dependency that has a part in `parts` must be started or be a candidate. Else it throws `Plugin "<id>" depends on plugin "<dependency>", which is not started`, naming the first such pair in candidate order and then dependency list order, and starts nothing. A dependency in `known` with no part here is allowed, as `startPlugins` allows it.
  - It orders the candidates with `nextToStart`, as `startPlugins` does, and starts each through `startWithCleanup` with a new `PartRecord` (new registrations, new `views`).
  - Once every candidate has started, it calls `ready()` on each one it started, in start order. It calls no `ready` on a part started before this call.
  - A start that throws has its registrations disposed and its error rethrown. The candidates started before it in this call stay started, and no `ready` runs.
- **Start order.** `started` keeps insertion order, so a part started again goes to the end. "Start order" in every rule below is the order of `started`. `stopAll` stops in reverse of it, as today.
- **`ready()`.** Calls `ready?.()` on every started part, in start order. The composition roots do not call it in this task: task 05 adds the call and removes `core.pageReady`.
- **A `ready` that throws is logged, and the host goes on (agent).** The host logs `ready of <id> failed: <errorText(error)>` under source `plugin-host` and calls the next part's `ready`. Neither `ready()` nor `start(ids)` rethrows it. Reason: `startWithCleanup` rethrows a failed start because the part never came up and the caller must know; at `ready` every part has started, and the caller has nothing to undo. One part's failed `ready` must not keep the parts after it from theirs, as `stopAll` runs every step.
- **`stop(pluginId)`** behaves as today, and resolves to the ids it stopped, in stop order: the list `stopOrder` gives (dependents newest first, then the part). It resolves to `[]` for a part not started. When a step throws, it still rejects with the first error, as today.
- **`restart(pluginId)`** awaits `stop(pluginId)`, then calls `start` with the ids it stopped, and resolves to those ids in stop order. Each part gets new registrations and new views, so a dependent that asks `dependency` gets the new provider's exports. Slots are untouched. When the stop rejects, `restart` rejects with that error and starts nothing.
- **`mayStop(pluginIds)`** asks the started parts that `pluginIds` names, in start order, and returns the first non-null reason as `"<id>: <reason>"`. A part with no `mayStop`, or a named id not started, gives no reason. It returns `null` when no part gives one. A `mayStop` that throws reaches the caller.
- **`stop(pluginId)` logs `stopping <id>`** for each part it stops, in stop order, as `stopAll` does, so a restart shows every dependent it took down.
- **`stopping()`** returns the ids in `inFlight` now, in the order their stops began.
- `stopAll` and the `stopping <id>` log line stay as they are, with one addition: the host records that `stopAll` began, and from then `start(ids)` throws `Plugin host is stopping` and starts nothing. Reason: quit waits with no cap, a `settings.json` edit during the wait reaches the switch, and nothing would stop a part started after the final stop's snapshot.
- **An id whose stop is in flight.** `start(ids)` skips it, since it is still in `started`, as for any started id. The switch's one queue never asks for it.
- **The order `restart` starts in.** `start(ids)`'s one rule: `parts` list order, dependencies first. It is not the previous `started` order, which an earlier restart may have changed.
- **A rejected stop.** `stop` rejects without the ids it stopped; a caller reads `host.started` for what is left. Say so in `stop`'s comment.
- Update the doc comments on `PluginHost` and `startPlugins` to say each rule above.

GIVEN parts `a` and `b` (depends on `a`) are both disabled WHEN `start(['b', 'a'])` runs THEN `a` starts, then `b`, then `a.ready()`, then `b.ready()`
GIVEN `a` and `b` (depends on `a`) are disabled WHEN `start(['b'])` runs THEN it throws `Plugin "b" depends on plugin "a", which is not started` and starts nothing
GIVEN `a` with exports and `b` that depends on it WHEN `restart('a')` runs THEN it resolves `['b', 'a']` and `b`'s `dependency('a')` is the new `a`'s view
GIVEN `b`'s `mayStop` returns `a round is open` WHEN `mayStop(['a', 'b'])` runs THEN it returns `b: a round is open`

Tests (all in `src/shared/plugin-host.test.ts`, named in the file's sentence style):
- Add to `'stops the dependents of a part first, newest first, then the part'`: `await host.stop('a')` resolves to `['c', 'b', 'a']`.
- Add to `'stop of a part not started does nothing'`: `host.stop('zzz')` resolves to `[]`.
- Add to `'$name: the second waits on the stop in flight and shares its error, and the part stops once'`: before `failDispose`, `host.stopping()` equals `['a']`; after both stops settle, it equals `[]`.
- New `it.each` `'start starts each named part not started, in dependency order, then calls ready on each'`. Each part's start pushes `start <id>` and its `ready` pushes `ready <id>`. Rows:
  - parts `[part('b', ['a']), part('a'), part('c')]`, disabled `['a', 'b']`, `start(['b', 'a'])` → `['start a', 'start b', 'ready a', 'ready b']` (no `c` entry: `c` started at `startPlugins` and its ready is not called).
  - parts `[part('a'), part('b')]`, disabled `['b']`, `start(['a', 'b', 'zzz'])` → `['start b', 'ready b']` (`a` started already; `zzz` has no part).
- New `'start throws, starting nothing, when a named part depends on a part not started and not named'`: parts `[part('a'), part('b', ['a'])]`, disabled `['a', 'b']`. `start(['b'])` throws `'Plugin "b" depends on plugin "a", which is not started'`; the start callback recorded no call; `host.started.size` is `0`.
- New `'ready calls each started part's ready in start order, and logs a throw and goes on'`: parts `[part('b', ['a']), part('a'), part('c')]`, with `b`'s `ready` throwing `new Error('b ready failed')`. `host.ready()` does not throw; the ready calls are `['a', 'b', 'c']`; the log holds `'plugin-host: ready of b failed: b ready failed'`.
- New `'restart stops the part and its dependents, then starts them again with new registrations and views'`: parts `[part('a', [], exports), part('b', ['a']), part('d')]`, where each `a` start returns `exports` that give `{ run: <start count of a> }`, and `b`'s start records `context.dependency('a')`. `restart('a')` resolves `['b', 'a']`; `b` recorded `[{ run: 1 }, { run: 2 }]`; the registrations `b` got on its second start are not the first (`not.toBe`); `[...host.started.keys()]` equals `['d', 'a', 'b']`.
- New `'restart starts in parts order, not the previous start order'`: parts `[part('a'), part('b', ['a']), part('c', ['a'])]`; `restart('b')`, then `restart('a')`; `[...host.started.keys()]` equals `['a', 'b', 'c']`. Break: restart replays `started` order.
- New `'restart rejects and starts nothing when its stop rejects'`: `b`'s dispose throws; `restart('b')` rejects with that error and `host.started` has no `b`.
- New `'a start that throws leaves earlier candidates started and runs no ready'`: `start(['x', 'y'])` with `y`'s start throwing; it rethrows, `x` is started, and no `ready` ran.
- New `'a ready that throws inside start(ids) is logged and not rethrown'`: `start(['x'])` with `x`'s `ready` throwing does not throw and logs `ready of x failed: …`.
- New `'start after stopAll began throws'`: call `stopAll()` (not awaited), then `start(['x'])` throws `Plugin host is stopping`; `x` is not started.
- New `it.each` `'mayStop returns the first reason a named started part gives, in start order'`. Parts `a` (reason `'a is busy'`), `b` (reason `'a round is open'`), `c` (no `mayStop`), started in that order. Rows:
  - ids `['b', 'a']` → `'a: a is busy'`
  - ids `['b', 'c']` → `'b: a round is open'`
  - ids `['c', 'zzz']` → `null`

Done when: `npm run typecheck` passes; the test gate runs `src/shared/plugin-host.test.ts` and `src/plugins/page.test.ts` (it starts the real page parts through `startPlugins`).

Commit: one commit for the group

## Proof
