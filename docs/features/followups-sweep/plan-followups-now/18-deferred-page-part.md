# 18 — A deferred page part waits on its withheld dependency

Status: not started
Type: Task
Rung: deep · crosses main's plugin switch and the page's part host through the start lifecycle of two processes
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Follow-up: `followups.md`, "A deferred built-in page part that page-depends on a user plugin withheld at launch stays
unstarted".

Files:
- modify `src/main/plugins/plugin-switch.ts`
- test `src/main/plugins/plugin-switch.test.ts`

Preconditions (run from `wigley-ai-gui/`):

| Claim | Command | Expected |
|---|---|---|
| Main's page start names only the ids it is handed | `sed -n 318,322p src/main/plugins/plugin-switch.ts` | `const pageStart = async (ids: readonly string[]) => { const reply = await deps.page({ kind: 'start', ids });` |
| A guarded start page-starts its own id alone | `grep -n 'await pageStart(\[id\]);' src/main/plugins/plugin-switch.ts` | one line (≈493) |
| A switch-on page-starts its built-ins before its user plugins start | `grep -n 'await pageStart(builtIns);' src/main/plugins/plugin-switch.ts` | one line (≈983) |
| The page skips a part already started | `grep -n '!started.has(part.manifest.id)' src/shared/plugin-host.ts` | one line in `startEach` (≈494) |
| The page loads a part it does not hold before starting it | `grep -n 'loadPageParts(entries' src/renderer/plugin-parts-answer.ts` | one line |
| `dependentsOf` gives the transitive dependents | `grep -n 'export function dependentsOf' src/shared/plugin-manifests.ts` | one line, already imported by `plugin-switch.ts` |

No built-in has such a dependency today, so the gap is latent; the test builds one.

Consumes: `dependentsOf(pluginId, disabled, manifests)` in `src/shared/plugin-manifests.ts`; `startOrder`,
`admittedManifests`, `applied.disabled()` inside `createPluginSwitch` (tree).

Produces: nothing exported; `pageStart` inside `createPluginSwitch` widens what it names.

Decisions:
- **Where it breaks.** Y is a built-in whose `dependsOn.page` names user plugin X. A page start of Y while X's page
  part is not started fails Y's dependency check on the page; when X later starts, main asks
  `pageStart([X])` and nothing asks for Y again. Two paths reach it: a switch-on of X and Y together (`switchOn`
  page-starts the built-in Y before `guardedStart(X)`), and a page load whose own start of Y (`startAtLoad`, whose
  reply main never sees) ran while X's page part was missing.
- **Main names the running dependents.** `pageStart(ids)` sends `ids` plus every id of
  `ids.flatMap((id) => dependentsOf(id, applied.disabled(), admittedManifests()))` not already in `ids`, the whole list
  in `startOrder()` order. `dependentsOf` follows `dependsOn.main` and `.page` transitively and skips the applied list,
  which holds every switched-off and withheld id, so only dependents that run in main are named. The page's
  `startEach` skips a part already started, and loads a held-but-unloaded built-in first, so naming a running
  dependent again costs nothing, and its reply's `started` clears the page problem an earlier failed start recorded.
- **Main, not the page.** The page's load-time loop has no reply channel to main, and main already owns which parts
  should run on the page; one rule in `pageStart` covers the guarded start, the switch-on, reload and restart paths.
- **Comments.** The `pageStart` comment says it also names each running dependent of `ids`, which the page skips when
  started; the `PluginSwitch` doc comment's sentence on page starts gains "and each page start names the running
  dependents of the ids it starts".
- **Existing expectations.** A test whose page start now names a running dependent changes its expected `page start`
  line to the widened list; that change is this fix, and each one is checked against the rule above, not loosened.

GIVEN built-in `y` with `dependsOn.page: ['x']` and user plugin `x`, both in the applied list
WHEN `apply([])` switches both on
THEN the page start calls are `page start y`, then `page start x,y`

GIVEN `y` withheld (`Needs plugin "x"`)
WHEN `x` starts
THEN `x`'s page start names `x` alone, since a withheld `y` is in the applied list, and `y`'s own guarded start
page-starts it as today

Tests (`plugin-switch.test.ts`):
With `X = user('x')` and `Y = entry('y', { manifest: { dependsOn: { main: [], page: ['x'] } } })`:
- `apply_DependentStartedFirst_PageStartNamesItAgainWithItsDependency`: `setup({ entries: [X, Y], applied:
  ['x', 'y'] })`, `await pluginSwitch.settled()`, clear `calls`, `await pluginSwitch.apply([])` →
  `calls.filter((call) => call.startsWith('page start'))` equals `['page start y', 'page start x,y']`
- `reload_WithheldDependent_StartsOnItsOwnPageStart`: `setup({ entries: [X, Y], applied: heldAtStart([X, Y]),
  disabled: [] })` with `main.startErrors = { x: ['boom'] }`, `await pluginSwitch.settled()` (both withheld), clear
  `calls`, then `changeCatalog(switched, [user('x', { revision: 2 }), Y])` → the `page start` lines of the calls it
  returns equal `['page start x', 'page start y']`

Done when: compiles; `npm test` runs `plugin-switch.test.ts` and every test passes, any changed expectation matching
the rule above.

Commit: one commit, "plugin switch: a page start also names the running dependents of its ids (deferred page part follow-up)".

## Proof
