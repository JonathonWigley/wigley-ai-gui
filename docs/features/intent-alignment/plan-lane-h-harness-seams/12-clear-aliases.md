# 12 — Clear aliases from the adapter

Status: done
Type: Task
Wave: 9 · Depends on: 11
Plan: [plan.md](plan.md)

Files:
- modify `src/plugins/chat/page/clear-commands.ts` · create test `src/plugins/chat/page/clear-commands.test.ts`
- modify `src/plugins/chat/page/slash-commands.ts` · test `src/plugins/chat/page/slash-commands.test.ts`
- modify `src/plugins/chat/page/start.ts`
- modify `src/plugins/chat/main/selftest-script.ts` (the "clear" group's step)
- modify `docs/features/agent-chat/design.md` (§ Terms "App slash command", § Flow "Clear")
- modify `docs/features/followups.md` · modify `docs/features/intent-alignment/master-plan.md`

Consumes:
- `coreAgentHarnessesSlot: KeyedSlotKey<AgentHarnessInfo, 'main', 'core'>` (`core.agentHarnesses`, keyed by harness
  id) in `src/contracts/core-state.ts` ← 01
- `AgentHarnessInfo.clearAliases: readonly string[]` in `src/contracts/agent.ts` ← 04
- Claude's `clearAliases` `['reset', 'new']` in the claude-code adapter's `info()` ← 04
- `KeyedSlotReader<V>` (`get`, `all`, `on`) in `src/contracts/state.ts` (tree today)
- `SlashCommands` (`add`, `match`, `list`) in `src/plugins/chat/page/slash-commands.ts` (tree today); `add` throws
  `App slash command /<name> is already registered` for a held name, and the registry holds no mark that tells an
  alias from another command

Produces:
- `export function addClearCommands(deps: ClearCommandDeps): Disposable` in `src/plugins/chat/page/clear-commands.ts`
- `harnesses: KeyedSlotReader<AgentHarnessInfo>;` and `log: PluginLog;` on `ClearCommandDeps` in
  `src/plugins/chat/page/clear-commands.ts`
- `addAlias(command: AppSlashCommand, onDropped: () => void): Disposable;` on `SlashCommands` in
  `src/plugins/chat/page/slash-commands.ts`

Decisions:
- `/clear` is the app's own name and is always registered. Each harness declares only the names beside it. Source:
  plan.md Decisions ("`/clear` stays the app's; each harness declares extra clear aliases").
- The page registers each distinct alias across every harness in `core.agentHarnesses`: harnesses in the slot's
  first-set order (`all()`), each harness's aliases in declared order, each name once. Source: dispatch.
- An alias typed in a session whose harness does not declare it clears that session anyway. Every app slash command
  is global today: `/login`, `/logout`, `/status` and every name another plugin adds through `addSlashCommand` run in
  any session, whatever its harness, and the clear itself runs through the app's `clear` channel call, which every
  harness supports. (drafter: follows that pattern.)
- On each change of the slot, the page computes the alias list again. When the list differs from the registered one,
  it disposes every alias registration and registers the new list. `/clear` stays registered through the change.
  (drafter.)
- An alias named `clear` is skipped, with no log: the app registers it already. An alias whose name another app
  command already holds (for example `login`) is skipped, and the page logs
  `` `clear alias /${name} skipped: /${name} is already registered` ``. `SlashCommands.add` throws on a held name
  today, and a throw there would stop the page part's start; the page checks `commands.list()` for the name before
  `addAlias`. (drafter: a log over a throw, as `addCompletionRow`
  logs a failing draw.)
- A clear alias yields to a command another plugin adds later, so a plugin's start never fails because of an alias.
  The registry can be made to tell an alias apart, so it is: `SlashCommands.addAlias(command, onDropped)` registers
  `command` as an alias (the registry keeps the set of alias commands beside the map). It throws for a held name, as
  `add` does. When `add` is called for a name an alias holds, `add` removes the alias, calls its `onDropped` once,
  and registers the new command in its place, with no throw. `add` still throws when the held command is not an
  alias. The alias's own `dispose` after that removes nothing (the registry checks identity, as `add`'s does today).
  `addClearCommands` registers each alias with `addAlias`, its `onDropped` logging
  `` `clear alias /${name} dropped: /${name} is registered by another command` ``. `/clear` itself stays an `add`: it
  is the app's own name and is registered first, so it is never an alias. (Route chosen over registering the aliases
  after every plugin page has started: the page host has no such hook, and the slot may change after it.)
- A dropped alias comes back only through the slot rule above: when the slot changes and the alias list differs, every
  alias registration is disposed and the new list registered, the dropped name then skipped and logged as held
  (`skipped: … is already registered`).
- `addClearCommands` returns one `Disposable` that disposes `/clear`, every alias registration and the slot listener.
  The page part keeps it unused, as it keeps today's return unused: the slash command store dies with the page.
  (drafter.)
- The description of `/clear` and of each alias stays `Clear the conversation and restart the agent`.
- The fake's `info().clearAliases` is `['reset']` (task 04). The self-test then proves an alias that reaches chat only
  through the registry. (drafter.)

Mandatory: AGENTS.md § A slot, § An agent harness; `docs/features/agent-harnesses/design.md` § Registry;
`docs/features/agent-chat/design.md` § Flow, Clear.

GIVEN no harness in the slot WHEN `addClearCommands` runs THEN the slash commands hold `clear` alone.
GIVEN two harnesses declaring `['reset', 'new']` and `['new', 'restart']` WHEN `addClearCommands` runs THEN the
slash commands hold `clear`, `reset`, `new`, `restart`, in that order.
GIVEN `/reset` registered from a harness WHEN the user sends `/reset` in any session THEN chat invokes
`clear` with that session's id.
GIVEN a registered alias `reset` WHEN the slot changes and no harness declares `reset` THEN `/reset` is no longer
registered and `/clear` still is.
GIVEN a registered alias `reset` WHEN another plugin adds an app command `reset` THEN the add does not throw, `/reset`
runs the added command, and the log reads `clear alias /reset dropped: /reset is registered by another command`.
GIVEN a harness declaring `login` while `/login` is registered WHEN `addClearCommands` runs THEN `/login` keeps the
account command, and the log reads `clear alias /login skipped: /login is already registered`.

Tests:
- create `src/plugins/chat/page/clear-commands.test.ts`. It uses the real `createSlashCommands()`, a recording
  `invoke`, a log array, and a stub `KeyedSlotReader<AgentHarnessInfo>` over a `Map` that calls its `on` listeners on
  `set` and `delete`. Each `AgentHarnessInfo` in it fills every required field
  (`label`, `capabilities`, `clearAliases`, `projectConfigFolder`, `profiles`).
  - `addClearCommands_Harnesses_RegistersClearThenEachDistinctAlias`: a table. Rows: no harness → `['clear']`;
    one harness `['reset', 'new']` → `['clear', 'reset', 'new']`; harnesses `['reset', 'new']` then
    `['new', 'restart']` → `['clear', 'reset', 'new', 'restart']`; one harness `['clear', 'reset']` →
    `['clear', 'reset']`. It asserts `commands.list().map((command) => command.name)`.
  - `addClearCommands_AliasRun_InvokesClearForTheSession`: one harness `['reset']`; run the matched `/reset` command
    with session id `row-1`; expect invokes `[['clear', 'row-1']]`.
  - `addClearCommands_SlotChanges_ReregistersTheAliases`: start with one harness `['reset']`, then replace it in the
    slot with `['new']`; expect names `['clear', 'new']` and `commands.match('/reset')` null.
  - `addClearCommands_AliasHeldByAnotherCommand_SkipsAndLogs`: add a `login` command first, then one harness
    `['login', 'reset']`; expect names `['login', 'clear', 'reset']`, the `login` command the first one added, and the
    log `['clear alias /login skipped: /login is already registered']`.
  - `addClearCommands_AliasThenPluginCommand_AliasYieldsAndLogs`: one harness `['reset']`; then `commands.add` a command
    named `reset` (not throwing); expect names `['clear', 'reset']`, `commands.match('/reset')` holding the added
    command, and the log `['clear alias /reset dropped: /reset is registered by another command']`; then dispose the
    `addClearCommands` handle and expect the added command still listed.
  - `addClearCommands_Dispose_RemovesEveryName`: one harness `['reset']`; dispose; expect `commands.list()` `[]`.
- `slash-commands.test.ts`: add `addAlias_LaterAddOfTheName_DropsTheAliasAndCallsOnDropped` (alias `reset`, then `add`
  of `reset`: no throw, `onDropped` called once, `list()` holds the added command alone for that name) and
  `addAlias_HeldName_Throws` (a plain `add` of `login`, then `addAlias` of `login` throws `App slash command /login is
  already registered`); `add_Twice_Throws` stays as it is.
- Self-test: in `CLEAR_STEPS` (`src/plugins/chat/main/selftest-script.ts`), the clear step sends `/reset` in place of
  `/clear`, and keeps its expect line `[chat] conversation cleared in chat-second` and its `alsoExpect`. The group's
  `why` reads: `/reset, the fake harness's clear alias, in the second session empties its Chat tab to one notice and
  restarts its agent, and the notes page moves the row to its new host session id.` The `/clear` name stays covered
  by the unit tests above.

Approach:
- `ClearCommandDeps` becomes `{ commands: SlashCommands; channel: Pick<PageChannel<ChatChannel>, 'invoke'>;
  harnesses: KeyedSlotReader<AgentHarnessInfo>; log: PluginLog }`.
- `src/plugins/chat/page/start.ts` passes `harnesses: api.state.read(coreAgentHarnessesSlot)` and
  `log: services.log`. This task adds that `core.agentHarnesses` read in `start.ts` itself, beside the
  `addClearCommands` call (tasks 05 and 10 each add a read for their own parts; a keyed slot reader is cheap, so the
  readers stay separate).
- The comment over `addClearCommands` stops naming Claude. It reads: registers `/clear` and each name a registered
  harness declares for it (`AgentHarnessInfo.clearAliases`); each clears the session's conversation and restarts its
  agent.

Docs:
- `docs/features/agent-chat/design.md` § Terms, "App slash command": replace `and `/clear` with Claude's names for
  it, `/reset` and `/new` (§ Flow, Clear).` with `and `/clear` with each name a registered harness declares for it
  (`clearAliases`: Claude's are `/reset` and `/new`) (§ Flow, Clear).`
- Same file, § Flow, "Clear": replace `` `/clear`, `/reset` and `/new` (registered by the page's
  `clear-commands.ts`, `` with `` `/clear` and each harness's clear aliases (registered by the page's
  `clear-commands.ts` from `core.agentHarnesses`; an alias clears any session, whatever its harness), ``.
- Line breaks in the file: the Terms sentence wraps after `Claude's` (a newline and two spaces before `names for it`), and the Clear bullet is one line. The old texts above are quoted on one line.

Done when: `npm run lint` and `npm run typecheck` pass; `grep -rn "'reset'\|'new'" src/plugins/chat/page --include='*.ts' | grep -v '\.test\.'` prints
no hit in `clear-commands.ts`; the test gate runs `clear-commands.test.ts`, `slash-commands.test.ts`, `start.test.ts` in
`src/plugins/chat/page/`, and `npm run selftest -- --plugin chat`.

Commit: one commit. It removes the "Clear aliases from the adapter" item from `docs/features/followups.md` § Harness
seams and ticks `[ ] Clear aliases from` to `[x] Clear aliases from` in
`docs/features/intent-alignment/master-plan.md` (the chat-pass line, line 133 at plan time).

## Proof

Commit 4eb8decc2 · proof: diff read: addClearCommands returns one Disposable, aliases from core.agentHarnesses re-registered on slot change, SlashCommands.addAlias present; self-test clear step sends /reset; wave compile (typecheck, lint) passes, oxfmt clean · concerns: clear aliases register app-wide from every harness, not per the session's harness; it.each row typed never[] (compiled clean)
