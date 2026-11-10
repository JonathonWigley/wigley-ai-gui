# 01 — A failed `ready` logs under its plugin, and the harness throws on it

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/shared/plugin-host.ts` · modify `src/shared/plugin-part-harness.test-support.ts` · test `src/shared/plugin-host.test.ts` · test `src/shared/plugin-part-harness.test.ts`
Consumes:  `startPlugins(parts, process, start, known?, disabled = [], log?)` in `src/shared/plugin-host.ts` (tree)
Produces:  the host's line `log(id, \`ready failed: ${errorText(error)}\`)` in `readyEach`, `src/shared/plugin-host.ts`
           `PartHarness.ready()` and `restart()` throwing `part harness: ready of <id> failed: <error>` in `src/shared/plugin-part-harness.test-support.ts`
Decisions: log under the plugin's id (round 1, Decided) · the harness fails loud, the host keeps logging and going on (plan.md, Decided)

## Changes

- **`readyEach`** (`src/shared/plugin-host.ts`) logs `log?.(id, \`ready failed: ${errorText(error)}\`)` in place of
  `log?.('plugin-host', \`ready of ${id} failed: …\`)`. Everything else stays: the next part's `ready` still runs,
  and nothing throws. Rewrite the two comments that quote the old line (the `ready()` doc on `PluginHost` near line 31,
  and `startPlugins`' `log` doc near line 403) to the new line, saying it logs under the plugin's id.
- **The harness's host gets a log.** `partLifecycle`'s `startPlugins` call passes the harness world's log as `log`,
  with `known` left `undefined` and `disabled` as `[]`, so each host line (`stopping <id>` included) lands in
  `harness.logs` as `{ source, message }`. `HarnessWorld` has no log member today (`createWorld` keeps `log` as a local): add
  `log: Log` to `HarnessWorld`, built once in `createWorld`, and have `startMainPart` and `startPagePart` pass
  `world.log` into `partLifecycle`.
- **`ready()` fails loud.** The lifecycle's `ready()` notes how many lines `harness.logs` holds, calls the host's
  `ready()`, then reads the lines added since: for the first line whose `source` is a hosted part's id and whose
  `message` starts with `ready failed: `, it throws
  `new Error(\`part harness: ready of ${source} failed: ${message.slice('ready failed: '.length)}\`)`. Every part's
  `ready` has run by then, since the host runs them all first. `restart()` calls the same `ready()`, so it throws the
  same way, after the restart's start.
- What `harness.started()` returns stays the part's own start result, unwrapped.
- An existing test that now throws because its part's `ready` throws is a hidden failure the change uncovers:
  report it in the task's Proof with the test's name, and fix the test only when its intent is plain from its name.
- An existing test that now fails because the host's own lines (`stopping <id>` under source `plugin-host`) land in
  `harness.logs` reads the log too broadly: change it to filter by the source it means (the plugin's id), and list
  each one in the Proof. The harness keeps every host line.

## Behaviour

GIVEN two started parts `a` then `b` whose `ready` throws `b ready failed` WHEN the host's `ready()` runs THEN the
log holds `b: ready failed: b ready failed` and `a`'s `ready` ran.

GIVEN a page or main part under test whose `ready` throws `boom` WHEN `harness.ready()` runs THEN it throws
`part harness: ready of <id> failed: boom`, and `harness.logs` holds `{ source: <id>, message: 'ready failed: boom' }`.

GIVEN a real provider part in `parts` whose `ready` throws, and a part under test whose `ready` records that it ran
WHEN `harness.ready()` runs THEN it throws naming the provider's id, and the part under test's `ready` ran.

GIVEN the same part WHEN `harness.restart()` runs THEN it rejects with the same error.

## Tests

- `plugin-host.test.ts:575` and `:898`: the expected line becomes `plugin-host`-free — `'b: ready failed: b ready failed'`
  and `'x: ready failed: x ready failed'`, matching how each test joins source and message today.
- `plugin-part-harness.test.ts`: one new table test, `ready throws when a part's ready threw`, rows: the part under
  test (main), the part under test (page), a real provider part in `parts` (page). Each row asserts the thrown
  message, the `harness.logs` entry, and for the provider row that the part under test's `ready` ran. One more row
  or a separate `it`: `restart()` rejects with the same message.

Done when: compiles; `npm run lint` passes; the test gate runs `src/shared/plugin-host.test.ts` and
`src/shared/plugin-part-harness.test.ts`.
Commit:    one commit for the group

## Proof

