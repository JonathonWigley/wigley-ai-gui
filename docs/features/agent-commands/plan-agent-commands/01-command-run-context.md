# 01 — Command run context: target, caller, reporting runs, the list and the two flags

Status: done
Type: Batch
Rung: deep · crosses the main and page processes through async IPC, and every later task consumes its contract
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Paths are under `wigley-ai-gui/`.

Files:
- modify `src/contracts/commands.ts`
- modify `src/contracts/plugin.ts`
- modify `src/contracts/bridge.ts`
- modify `src/shared/command-registry.ts`
- modify `src/shared/command-router.ts`
- modify `src/shared/runtime-commands.ts`
- modify `src/main/page-commands.ts`
- modify `src/preload/preload.ts`
- modify `src/renderer/renderer.ts`
- modify `src/main/main.ts`
- modify `src/shared/plugin-catalog/validate-manifest.ts`
- modify `src/shared/plugin-catalog/manifest-schema.ts`
- modify `src/shared/plugin-part-harness.test-support.ts`
- modify `src/shared/plugin-catalog/manifest.test-support.ts`
- test `src/shared/command-registry.test.ts`
- test `src/shared/command-router.test.ts`
- test `src/shared/runtime-commands.test.ts`
- test `src/main/page-commands.test.ts`
- test `src/preload/preload.test.ts`
- test `src/shared/plugin-catalog/validate-manifest.test.ts`
- test `src/shared/plugin-catalog/manifest-schema.test.ts`

Consumes:  none (members the tree holds: `CommandRegistry.run`, `createCommandRouter`, `createRuntimeCommands`,
           `createPageCommands`, `BRIDGE_CHANNELS.commandRun*`, `validateManifest`)
Produces:  `export interface CommandSessions { readonly targetSessionId?: string; readonly callerSessionId?: string }` in `src/contracts/commands.ts`
           `export interface CommandRunOptions { readonly reportErrors?: true }` in `src/contracts/commands.ts`
           `export interface CommandHop extends CommandSessions, CommandRunOptions {}` in `src/contracts/commands.ts`
           `export type CommandOutcome = 'ran' | 'skipped'` in `src/contracts/commands.ts`
           `risky?: true` and `targets?: true` on `CommandDecl` in `src/contracts/plugin.ts`
           `export interface PageCommandContext<A = undefined> extends CommandSessions` in `src/contracts/plugin.ts`
           `export interface MainCommandContext<A = undefined> extends CommandSessions` in `src/contracts/plugin.ts`
           `runFor(id: CommandId, arg: unknown, sessions: CommandSessions): Promise<CommandOutcome>` on `PluginCommands` in `src/contracts/plugin.ts`
           `list(): readonly CommandInfo[]` on `PluginCommands` in `src/contracts/plugin.ts`
           `run(id: CommandId, context: Context, options?: CommandRunOptions): Promise<CommandOutcome>` on `CommandRegistry` in `src/shared/command-registry.ts`
           `remote(id: CommandId, arg: unknown, hop: CommandHop): Promise<CommandOutcome>` on `CommandRouterDeps` and `RuntimeCommandsDeps`
           `run(command, arg, extras?, options?: CommandRunOptions): Promise<CommandOutcome>` on `CommandRouter` in `src/shared/command-router.ts`
           `run(id: CommandId, arg: unknown, hop?: CommandHop): Promise<CommandOutcome>` on `PageCommands` in `src/main/page-commands.ts`
           `runCommand(id: CommandId, arg: unknown, hop?: CommandHop): Promise<CommandOutcome>` and
           `onRunCommand(listener: (id: CommandId, arg: unknown, hop: CommandHop) => Promise<CommandOutcome>): void` on `Bridge` in `src/contracts/bridge.ts`
           `hop: CommandHop` on `HarnessCommandRun` in `src/shared/plugin-part-harness.test-support.ts`

Decisions:
- The two session ids ride beside the argument, never inside it: a command's one argument stays its own (round 1).
- **`targets: true`** on a declaration marks a command that acts on a given session without that session's UI shown
  or focused (lead ruling 1). Only such a command reads `targetSessionId`. 04 and 06 set the flag; this task adds the
  field, its validation and the `runFor` refusal.
- Reporting is opt-in per run. Keys, clicks, `commands.run` and `runBound` keep today's rule: a failure is logged under
  its owner and the run resolves (round 3).
- **Outcome.** Every run resolves a `CommandOutcome`: `'ran'` when the handler ran to its end without throwing,
  `'skipped'` when an intercept settled without calling `next`, so no handler ran. Today's callers ignore the value.
  "Ran" never proves the effect; 08's tool description says so (lead ruling 8).
- **Reporting failures.** `CommandRegistry.run` with `reportErrors: true` still logs each failure as today, then
  rejects once the chain settles with `Error(errorText(first))`, where `first` is the first failure in time: a handler
  failure or a wrap failure (`intercept of <id> failed`) alike. `onDidRun` still hears nothing of a failed run.
- `CommandRouter.run` passes `extras` (the session ids among them) to the local registry as today. For a command of the
  other process it calls `remote(id, arg, hop)`, where `hop` holds `targetSessionId` and `callerSessionId` from
  `extras` and `reportErrors` from `options`. Fields that are undefined are left out of `hop`.
- **`runFor`** never throws at the call. Every refusal is a rejection, and it runs with `reportErrors: true`:
  - an unknown id → `Error('Unknown command <id>')`
  - a bad argument → the argument checker's text, as `run` logs it today
  - no handler → `Error('<id> has no handler')`
  - a `targetSessionId` for a command whose info lacks `targets: true` → `Error('<id> takes no session')`
- **`list()`** gives one `CommandInfo` per id, from this process's catalog, the other process's catalog, then the served
  config, in that order of precedence (the order `infoOf` reads). It drops a served entry marked `runtime: true` that
  neither live catalog holds: an old page's command cannot run, and the agent trusts the list. Sort by `id` in
  code-unit order.
- **`PageCommands.run(id, arg, hop)`**:
  - No page, or no started page: with `hop.reportErrors` it rejects with `Error('<id> not run: no page')`. Without it,
    it logs `<id> not run: no page` and resolves `'skipped'`, as today.
  - `commandRunDone` carries `(request, outcome, errorText)`, with `errorText` a string or `null`. A reporting run with
    an error text rejects with `Error(<error text>)`. Every other run resolves the outcome.
  - `pageGone()` rejects each waiting reporting run with `Error('<id> ended with the page')`, and resolves each other
    run `'skipped'`, logging each as today.
- **Main to page.** `commandRunInPage` sends `(request, id, arg, hop)`. The preload's `onRunCommand` hands the listener
  `hop` (`{}` when main sent none). When the listener resolves, it sends `commandRunDone` with `(request, outcome,
  null)`. When it rejects, it sends `(request, 'skipped', errorText(error))`.
- The renderer's `onRunCommand` listener runs `commands.router.run(id, arg, { targetSessionId, callerSessionId },
  { reportErrors })` from the hop. For a reporting hop it lets a failure reject, and the preload turns it into text.
  For any other hop it logs `command <id> failed: …` and resolves, as today.
- **Page to main.** The renderer's `remote` calls `bridge.runCommand(id, arg, hop)`. The preload's `runCommand`
  forwards `hop` as the third invoke argument of `commandRun`. Main's `commandRun` handler picks only
  `targetSessionId`, `callerSessionId` (each a string) and `reportErrors` (only `true`) from the untrusted hop. It then
  runs `commands.router.run(id, arg, sessions, { reportErrors })` and returns the outcome. For a reporting hop the
  renderer's `remote` rethrows a failure; for any other hop it logs as today.
- **`risky` and `targets` in a user plugin's manifest.**
  - `validateManifest` accepts each only as `true`. The problem texts are `<name> risky must be true` and `<name>
    targets must be true`.
  - The JSON Schema declares each as `{ const: true }`.
  - Add both to `COMMAND_FIELDS`, and add both to the every-field manifest `validManifest()` in
    `manifest.test-support.ts`.
- **Implementations of `PluginCommands`.** The one real implementation is the `commands` object `forPlugin` builds in
  `runtime-commands.ts`. The plugin harness gains:
  - `runFor` and `list`
  - a `remote(id, arg, hop)` that records `hop` in `HarnessCommandRun`, so tests of 06 and 08 can read the run's
    sessions

  A fake that only records runs may throw `not used` from them.
- **Comments.** Update in this commit every comment the change makes untrue:
  - `CommandRegistry.run` ("never rejects")
  - `CommandHandler` ("the run's promise resolves")
  - `PluginCommands` (a run a page cannot take; add `runFor` and `list`)
  - the `CommandRouter` and `PageCommands` headers
  - `Bridge.runCommand` and `onRunCommand`
  - `CommandRouterDeps.remote`

GIVEN a handler that throws `boom` WHEN the registry runs it with `reportErrors: true` THEN the run logs `owner: command p.go failed: boom` and rejects with `boom`
GIVEN the same handler WHEN the registry runs it with no options THEN it logs the same line and resolves
GIVEN a wrap that calls `next` and then throws `boom` WHEN the registry runs the command with `reportErrors: true` THEN it rejects with `boom`
GIVEN an intercept that settles without calling `next` WHEN the registry runs the command with `reportErrors: true` THEN it resolves `'skipped'`
GIVEN a page command WHEN main runs it with `{ targetSessionId: 's1', callerSessionId: 'c1' }` and `reportErrors` THEN `remote` receives `('p.go', arg, { targetSessionId: 's1', callerSessionId: 'c1', reportErrors: true })`
GIVEN a reporting page run WHEN the page sends `commandRunDone(7, 'skipped', 'boom')` THEN `PageCommands.run` rejects with `boom`; a plain run resolves
GIVEN no page, or a page still starting WHEN a reporting run starts THEN it rejects with `p.go not run: no page`
GIVEN a waiting reporting run WHEN `pageGone()` runs THEN it rejects with `p.go ended with the page`
GIVEN the preload's listener rejects with `boom` WHEN it settles THEN the preload sends `[commandRunDone, 7, 'skipped', 'boom']`; on resolve with `'ran'` it sends `[commandRunDone, 7, 'ran', null]`
GIVEN a command declared in the served config, another in the page's runtime catalog, and a stale served runtime entry WHEN `list()` runs THEN it returns the first two, once each, sorted by id
GIVEN an unknown id, or a target for a command without `targets` WHEN `runFor` runs THEN it returns a rejected promise and does not throw at the call

Tests:
- `src/shared/command-registry.test.ts`:
  - Add a `reportErrors` column to the table `run_HandlerThrowsOrRejects_LogsUnderOwnerAndResolves`. The rows are
    throws and rejects, each with and without `reportErrors`. With it the run rejects with `boom`; without it the run
    resolves. The log line is the same in all four.
  - Turn `intercept_WrapThrows_LogsUnderTheWrapOwnerAndResolves` into a table the same way: its reporting row rejects
    with `boom`.
  - Add one row `intercept_WrapSkipsNext` (with `reportErrors`): it resolves `'skipped'`.
  - Add one row where the handler runs and resolves: it resolves `'ran'`.
- `src/shared/command-router.test.ts`:
  - Extend `run_Extras_ReachTheHandlerWithTheArg` with the two session ids.
  - Extend `run_OtherProcessCommand_GoesToRemoteAndNoLocalIntercept` to assert the exact `hop` passed to `remote`.
- `src/shared/runtime-commands.test.ts`:
  - New `it('list gives each live command once, catalogs before the served config, sorted by id')`, with a stale served
    runtime row.
  - New `it.each` for `runFor` refusals (unknown id, bad argument, a target for a command without `targets`): each is a
    rejection with the text above, and none throws at the call.
- `src/main/page-commands.test.ts`:
  - Add a reporting column to `run_NoPageOrNotStarted_LogsAndResolves`. Both rows reject with `p.go not run: no page`
    when reporting; the plain rows keep the log line.
  - Turn `run_PageAnswers_ResolvesOnDone` and `pageGone_WaitingRun_LogsAndResolves` into tables with a reporting
    column: a reporting run rejects with the texts above, and a plain run resolves.
- `src/preload/preload.test.ts`:
  - `runFromMain` gains a `hop` parameter, and `heard` records `[id, arg, hop]`.
  - In `onRunCommand_ListenerSettles_SendsDone`, add the expected send to each row: `[commandRunDone, 7, 'ran',
    null]` for resolves and `[commandRunDone, 7, 'skipped', 'boom']` for rejects. One row sends `{ targetSessionId:
    's1', callerSessionId: 'c1', reportErrors: true }` and expects the listener to hear exactly it.
  - Add one `runCommand` row asserting the invoke args `[commandRun, id, arg, hop]`.
- `src/shared/plugin-catalog/validate-manifest.test.ts`: add rows to the existing fault table for `risky: false`,
  `risky: 'yes'`, `targets: false` and `targets: 1`.
- `src/shared/plugin-catalog/manifest-schema.test.ts`: one `it` asserting that
  `commands.additionalProperties.properties.risky` and `.targets` each equal `{ const: true }`.

Done when: `npm run typecheck` passes; the test gate runs the tests above. The renderer and `main.ts` wiring is checked
live by 10 (Final verification).
Commit:    one commit for the group

## Proof

Commit fa8146889 · proof: diff read: every Produces present (contracts/commands.ts, plugin.ts, bridge.ts, registry, router, page-commands, harness hop); wave-1 typecheck passes after 6b-fix commit · concerns: runFor casts sessions as Omit<Context,'arg'>; commandHopOf has no direct test (only the router row); edits outside Files: test fakes resolve 'ran', base-kit runLogged takes Promise<unknown>
