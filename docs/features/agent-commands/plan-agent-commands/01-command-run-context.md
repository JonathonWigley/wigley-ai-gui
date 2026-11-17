# 01 — Command run context: target, caller, reporting runs, the list and the risky flag

Status: not started
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
- test `src/shared/command-registry.test.ts`
- test `src/shared/command-router.test.ts`
- test `src/shared/runtime-commands.test.ts`
- test `src/main/page-commands.test.ts`
- test `src/preload/preload.test.ts`
- test `src/shared/plugin-catalog/validate-manifest.test.ts`

Consumes:  none (members the tree holds: `CommandRegistry.run`, `createCommandRouter`, `createRuntimeCommands`,
           `createPageCommands`, `BRIDGE_CHANNELS.commandRun*`, `validateManifest`)
Produces:  `export interface CommandSessions { readonly targetSessionId?: string; readonly callerSessionId?: string }` in `src/contracts/commands.ts`
           `export interface CommandRunOptions { readonly reportErrors?: true }` in `src/contracts/commands.ts`
           `export interface CommandHop extends CommandSessions, CommandRunOptions {}` in `src/contracts/commands.ts`
           `risky?: true` on `CommandDecl` in `src/contracts/plugin.ts`
           `export interface PageCommandContext<A = undefined> extends CommandSessions` in `src/contracts/plugin.ts`
           `export interface MainCommandContext<A = undefined> extends CommandSessions` in `src/contracts/plugin.ts`
           `runFor(id: CommandId, arg: unknown, sessions: CommandSessions): Promise<void>` on `PluginCommands` in `src/contracts/plugin.ts`
           `list(): readonly CommandInfo[]` on `PluginCommands` in `src/contracts/plugin.ts`
           `run(id: CommandId, context: Context, options?: CommandRunOptions): Promise<void>` on `CommandRegistry` in `src/shared/command-registry.ts`
           `remote(id: CommandId, arg: unknown, hop: CommandHop): Promise<void>` on `CommandRouterDeps` and `RuntimeCommandsDeps`
           `run(command, arg, extras?, options?: CommandRunOptions): Promise<void>` on `CommandRouter` in `src/shared/command-router.ts`
           `run(id: CommandId, arg: unknown, hop?: CommandHop): Promise<void>` on `PageCommands` in `src/main/page-commands.ts`
           `runCommand(id: CommandId, arg: unknown, hop?: CommandHop): Promise<void>` and
           `onRunCommand(listener: (id: CommandId, arg: unknown, hop: CommandHop) => Promise<void>): void` on `Bridge` in `src/contracts/bridge.ts`

Decisions:
- The two session ids ride beside the argument, never inside it: a command's one argument stays its own (round 1).
- Reporting is opt-in per run. Keys, clicks, `commands.run` and `runBound` keep today's rule: a failure is logged under
  its owner and the run resolves (round 3).
- `CommandRegistry.run` with `reportErrors: true` still logs each failure as today, then rejects with the first
  failure's error once the chain settles. `onDidRun` still hears nothing of a failed run.
- `CommandRouter.run` passes `extras` (the session ids among them) to the local registry as today. For a command of the
  other process it calls `remote(id, arg, hop)`, where `hop` holds `targetSessionId` and `callerSessionId` from
  `extras` and `reportErrors` from `options`. Fields that are undefined are left out of `hop`.
- `runFor` never throws at the call. Every refusal — an unknown id, a bad argument, no handler — is a rejection. It
  runs with `reportErrors: true`.
- `list()` gives one `CommandInfo` per id, from this process's catalog, the other process's catalog, then the served
  config, in that order of precedence (the order `infoOf` reads). Sort by `id`.
- `PageCommands.run(id, arg, hop)`:
  - no page or no started page: with `hop.reportErrors` it rejects with `Error('<id> not run: no page')`; without it,
    it logs `<id> not run: no page` and resolves, as today.
  - `commandRunDone` gains a second value, the error text or `null`. A reporting run with an error text rejects with
    `Error(<error text>)`; every other run resolves.
  - `pageGone()` rejects each waiting reporting run with `Error('<id> ended with the page')` and resolves the others,
    logging each as today.
- `commandRunInPage` sends `(request, id, arg, hop)`. The preload's `onRunCommand` hands the listener `hop` (`{}` when
  main sent none) and sends `commandRunDone` with `(request, null)` when the listener resolves, and with
  `(request, errorText(error))` when it rejects.
- The renderer's `onRunCommand` listener runs `commands.router.run(id, arg, { targetSessionId, callerSessionId },
  { reportErrors })` from the hop. For a reporting hop it lets a failure reject (the preload turns it into text); for
  any other hop it logs `command <id> failed: …` and resolves, as today.
- The page→main direction carries the hop too: the renderer's `remote` calls `bridge.runCommand(id, arg, hop)`; for a
  reporting hop it rethrows a failure, for any other it logs as today. Main's `commandRun` handler runs
  `commands.router.run(id, arg, sessions, { reportErrors })` from the hop.
- `risky` in a user plugin's manifest: `validateManifest` accepts it only as `true`, with the problem text
  `<name> risky must be true` otherwise, and the JSON Schema declares it as `{ const: true }`. Add `risky` to
  `COMMAND_FIELDS`.
- Every implementation of `PluginCommands` (the plugin harness and any test fake the compiler names) gains `runFor` and
  `list`; a fake that only records runs may throw `not used` from them.

GIVEN a handler that throws `boom` WHEN the registry runs it with `reportErrors: true` THEN the run logs `owner: command p.go failed: boom` and rejects with `boom`
GIVEN the same handler WHEN the registry runs it with no options THEN it logs the same line and resolves
GIVEN a page command WHEN main runs it with `{ targetSessionId: 's1', callerSessionId: 'c1' }` and `reportErrors` THEN `remote` receives `('p.go', arg, { targetSessionId: 's1', callerSessionId: 'c1', reportErrors: true })`
GIVEN a reporting page run WHEN the page sends `commandRunDone(7, 'boom')` THEN `PageCommands.run` rejects with `boom`; a plain run resolves
GIVEN no started page WHEN a reporting run starts THEN it rejects with `p.go not run: no page`
GIVEN a waiting reporting run WHEN `pageGone()` runs THEN it rejects with `p.go ended with the page`
GIVEN the preload's listener rejects with `boom` WHEN it settles THEN the preload sends `[commandRunDone, 7, 'boom']`; on resolve it sends `[commandRunDone, 7, null]`
GIVEN a command declared in the served config and another in the page's runtime catalog WHEN `list()` runs THEN it returns both, once each, sorted by id
GIVEN an unknown id WHEN `runFor` runs THEN it returns a rejected promise and does not throw at the call

Tests:
- `src/shared/command-registry.test.ts`: add a `reportErrors` column to the table `run_HandlerThrowsOrRejects_LogsUnderOwnerAndResolves`
  (rows: throws and rejects, each with and without `reportErrors`; with it the run rejects with `boom`, without it it
  resolves; the log line is the same in all four). Add one row to `intercept_WrapThrows_LogsUnderTheWrapOwnerAndResolves`
  turned into a table the same way.
- `src/shared/command-router.test.ts`: extend `run_Extras_ReachTheHandlerWithTheArg` with the two session ids;
  extend `run_OtherProcessCommand_GoesToRemoteAndNoLocalIntercept` to assert the exact `hop` passed to `remote`.
- `src/shared/runtime-commands.test.ts`: new `it('list gives each command once, catalogs before the served config, sorted by id')`;
  new `it.each` for `runFor` refusals (unknown id, bad argument): each a rejection, none a throw at the call.
- `src/main/page-commands.test.ts`: turn `run_PageAnswers_ResolvesOnDone` and `pageGone_WaitingRun_LogsAndResolves`
  into tables with a reporting column (reporting run rejects with the texts above; plain run resolves); add the
  no-page row to the same table as `run_PageAnswers_ResolvesOnDone`.
- `src/preload/preload.test.ts`: in `onRunCommand_ListenerSettles_SendsDone`, add the expected send to each row:
  `[commandRunDone, 7, null]` for resolves, `[commandRunDone, 7, 'boom']` for rejects; assert the listener heard the hop.
- `src/shared/plugin-catalog/validate-manifest.test.ts`: add rows to the existing fault table for `risky: false` and
  `risky: 'yes'` (problem `<name> risky must be true`), and add `risky: true` to the every-field manifest of
  `accepts a manifest with every field, dropping $schema`.

Done when: `npm run typecheck` passes; the test gate runs the tests above. The renderer and `main.ts` wiring is checked
live by 10 (Final verification).
Commit:    one commit for the group
