# Agent commands — plan

Feature: agent commands · Implements: none · Ticket: none
Target: `main` · Written: 2026-11-17

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

An agent connected to the live app runs any app command and reads any app state, through three MCP tools that never
change shape: `list_commands`, `run_command` and `read_state`. A run aims a target-capable command (declared `targets:
true`) at any session without moving the user's view. A risky command asks the user Allow or Deny first. `chat.sendTo` sends text into another
session, framed so the target agent and the user see which session's agent sent it.

## Architecture

Systems touched, all in `wigley-ai-gui/`:

- **Core commands** (`src/contracts/`, `src/shared/command-*.ts`, `src/shared/runtime-commands.ts`,
  `src/main/page-commands.ts`, `src/preload/`, `src/renderer/renderer.ts`, `src/main/main.ts`): the run context carries
  `targetSessionId` and `callerSessionId`; a run resolves `'ran'` or `'skipped'`; a reporting run rejects with its
  failure; `commands.list()`; the `risky` and `targets` flags on `CommandDecl`.
- **Core state** (`src/shared/state/slot-store.ts`, `src/main/plugins/main-api.ts`): `readAny` and `slotIds` for a main
  part whose manifest declares `readsEverySlot`.
- **Plugins**: `forms` (the `confirm` export), `chat` (`chat.sendTo`, the frame line, the "from" tag, `isUnattended`,
  `senderName`, target resolvers), `sessions`, `workflow`, `workflow-large` (target resolvers), the manifests of the
  risky and target sets, and the new main-only plugin `agent-commands`.

The design doc is `wigley-ai-gui/docs/features/agent-commands/design.md`. Every copy, format and set in it is pinned.

## Preconditions

Each claim was checked at plan time, on tip `34e478234` (the docs commit `fb0ca6b01` sits on it). Run each command from
the `ai` worktree root; `wigley:make` runs them again before the first dispatch.

| Claim | Command | Result at plan time |
|---|---|---|
| The relay hello carries the host session id and no row id | `grep -c '"session_id"' wigley-ai-marketplace/plugins/wigley/scripts/forms/relay.py; grep -rln 'WIGLEY_SESSION_ROW\|SESSION_ROW_ENV' wigley-ai-marketplace/plugins/wigley/scripts/forms wigley-ai-gui/src/plugins/sessions \| wc -l` | `1`, then `0` |
| No `risky` or `targets` field exists yet | `grep -c 'risky\|targets?:' wigley-ai-gui/src/contracts/plugin.ts wigley-ai-gui/src/shared/plugin-catalog/validate-manifest.ts` | `0` each |
| No run target, caller or reporting run exists yet | `grep -c 'targetSessionId\|callerSessionId\|runFor' wigley-ai-gui/src/contracts/plugin.ts wigley-ai-gui/src/contracts/commands.ts wigley-ai-gui/src/shared/command-router.ts` | `0` each |
| The page's done message carries only the request number | `grep -n 'commandRunDone, request)' wigley-ai-gui/src/preload/preload.ts` | line 81 |
| Forms' main part exports nothing | `grep -c exports wigley-ai-gui/src/plugins/forms/main/start.ts` | `0` |
| No `agent-commands` plugin exists | `test ! -e wigley-ai-gui/src/plugins/agent-commands && echo absent` | `absent` |
| Chat has no `sendTo` and no `isUnattended` | `grep -c 'sendTo\|isUnattended' wigley-ai-gui/src/plugins/chat/manifest.ts wigley-ai-gui/src/plugins/chat/contract.ts` | `0` each |
| `autoClearAndMake` is a setting, not a command; `clearAndMake` and `resumeMake` are commands | `grep -c autoClearAndMake wigley-ai-gui/src/plugins/workflow-large/stages/index.ts; grep -n 'clearAndMake:\|resumeMake:' wigley-ai-gui/src/plugins/workflow-large/stages/index.ts` | `0`, then lines 59 and 74 |
| No by-id slot read exists in the plugin API | `grep -c 'readAny\|readsEverySlot\|slotIds' wigley-ai-gui/src/contracts/plugin.ts wigley-ai-gui/src/shared/state/slot-store.ts` | `0` each |
| Every plugin command of the risky and target sets is declared | `for p in app-update:install sessions:closeSession sessions:listClose sessions:closePane sessions:renameSession session-stash:noteAccept docs:trash docs:conflictReload notes:remove notes:removeSession notes:discard notes:confirmYes settings:reset settings:removeBind workflow:mainAction workflow:stageAction workflow:toggleHeadless forms:submit forms:confirmCancel primer:submit primer:confirmCancel audio-picker:submit audio-picker:confirmCancel unity-pool:open live-view:openScreenSettings chat:stopAll chat:endSession chat:allowOrCopy chat:allowEntry chat:removeImage chat:removeImageAt chat:removeShownImage chat:send chat:sendNow chat:interrupt; do grep -q "^    ${p##*:}: {" wigley-ai-gui/src/plugins/${p%%:*}/manifest.ts && printf '%s ok, ' $p; done` | 35 `ok` |
| The core declares `core.openLink` and `core.reloadPlugin` | `grep -c 'CORE_OPEN_LINK.id\|CORE_RELOAD_PLUGIN.id' wigley-ai-gui/src/config/keymap.ts` | `2` |

## Docs written ahead

Commit `fb0ca6b01`, revised with this plan's cold-read fixes (the risky rule and set, the target flag, list slots as
arrays, the confirm's fresh round):

- `wigley-ai-gui/docs/features/agent-commands/design.md` — the whole design.
- `wigley-ai-gui/AGENTS.md` — § Architecture: the command bullet, the slot bullet, the MCP tool bullet, the
  `agent-commands/` entry in the plugin tree, the forms and chat entries; each marked planned. The stale line on
  the relay hello's row id is fixed.
- `wigley-ai-gui/DESIGN.md` — § Surfaces, Chat: the "from" Tag, marked planned.
- `wigley-ai-marketplace/plugins/wigley/scripts/forms/README.md` — the three tools and the pre-approval note, marked
  planned; the wigley plugin is at `2.15.1` for it.

## Mandatory Reads

- `wigley-ai-gui/AGENTS.md` — § Intent, § Architecture (A plugin, A registration, A slot, A command, An MCP tool, A
  session popup), § Running and testing.
- `wigley-ai-gui/DESIGN.md` — § Primitives (Tag), § Surfaces (Chat).
- `wigley-ai-gui/docs/features/agent-commands/design.md`.
- `wigley-ai-gui/.agents/skills/drive/SKILL.md` — for the final verification task only.
- No `CLAUDE*.md` and no `.claude/rules/*.md` exists under `wigley-ai-gui/` (`find wigley-ai-gui -name 'CLAUDE*.md' -not
  -path '*/node_modules/*'` prints nothing).

## Design Overview

The flow after the change, for the worked case "send 'run the tests' to gamma 2":

```
agent ──read_state {slot: sessions.rows}──▶ agent-commands (main)
        ◀── JSON of every row ─────────────  api.state.readAny('sessions.rows')
agent ──run_command {command: chat.sendTo, arg: {sessionId, text}}──▶ agent-commands
        agent-commands: info = commands.list() entry; not risky; arg.sessionId is a row
        commands.runFor('chat.sendTo', arg, { callerSessionId: caller.id })  ─▶ 'ran'
          └▶ router (main) ─▶ chat main sendTo handler
               └▶ chat send(target, frameAgentMessage(senderName(caller), text))
        ◀── "Ran chat.sendTo." ───────────────
target chat page: entry text opens with the frame line ─▶ UserInput.from = caller name ─▶ layout draws Tag "from <name>"

risky case:
run_command {command: docs.trash}
  caller headless or unattended ─▶ error result, nothing runs
  else forms.confirm(caller.id, {title, detail}, signal, toolUseId)
       ─▶ a fresh round (nonce in its question title) over the caller's tabs, or the caller's row marked
       Allow ─▶ commands.runFor(...) ; a rejection ─▶ its error text ; anything else ─▶ "The user denied docs.trash."

target-capable page command run from main with a target (a `session` on any other command is refused):
  router.run(id, arg, {targetSessionId, callerSessionId}, {reportErrors: true})
    ─▶ remote(id, arg, hop) ─▶ page-commands ─▶ commandRunInPage(request, id, arg, hop)
    ─▶ preload ─▶ renderer router.run(id, arg, sessions, {reportErrors})
    ─▶ handler reads context.targetSessionId first
    ◀── commandRunDone(request, outcome, errorText | null) ─▶ reject when errorText and the run reports
```

Decisions (from the interview and the design review; each binds every task):

- Target on the run: `run_command` takes an optional `session` (round 1). Only a command declared `targets: true` —
  one that acts on a session without that session's UI shown or focused — reads it; `runFor` and `run_command` refuse
  a `session` for any other (lead ruling 1).
- One new command `chat.sendTo {sessionId, text}`; `chat.send` keeps sending the composer box (round 1).
- Confirm the risky few, flagged on the command's own declaration (round 2). The rule: a command is risky when it
  destroys or discards user state, closes or stops a session, installs or restarts, opens something outside the app,
  or approves on the user's behalf; every route to such an action is flagged (lead ruling 7).
- Tools `list_commands`, `run_command`, `read_state`; `run_command` reports refusals and a handler's failure; key and
  click runs keep log-and-resolve (round 3).
- A message from another session's agent shows a "from <session>" tag in the target chat; other commands show only as
  the tool call in the caller's chat (round 4).
- The confirm shows over the caller's tabs like a forms round; a terminal caller gets its row marked (round 5).
- The target agent gets one frame line naming the sender and saying the user did not type it; the app's tag is drawn
  from that line (round 6).
- Every connected session may call the tools, terminal sessions and subagents included (Decided).
- A risky command from a headless or unattended session is refused with a reason, never asked (Decided).
- `agent-commands` is a deep module: three tools in, all command, slot and confirm work behind them (design review).
- The confirm recommends Deny, so a stray Enter and the headless auto-answer never allow (Decided at plan time). Every
  confirm is a fresh round with a per-call nonce, so no earlier answer is replayed or pre-picked (lead ruling 6).
- `Ran <id>.` means the handler finished without throwing; an intercept that skips the handler answers `Skipped`
  (lead ruling 8). The agent reads state to check an effect.
- A `chat.sendTo` with no caller sends the text unframed; the frame's sender name has one owner,
  `frameSenderName` (lead rulings 3, 4).
- The page shows a framed message as Tag and body everywhere it shows the text (lead ruling 5).
- `read_state` takes an optional `slot` (absent lists the slot ids) and an optional `key`; `list_commands` takes an
  optional `filter` (Decided at plan time).
- `run_command` refuses a `session` that names no row in `sessions.rows` (Decided at plan time).
- A drive run calls the tools through `agent-commands` drive actions, since the fake harness calls no MCP tool (Decided
  at plan time).

Out of scope: aiming a command that needs its own UI open (`forms.*`, `picker.*`) at another session — run without
`session`, it acts on the user's shown UI, as a key does; an auth token on the relay; app quit and git operations, which
no command does.

## File Structure

Paths under `wigley-ai-gui/`.

Existing files modified:

- `src/contracts/commands.ts`, `src/contracts/plugin.ts`, `src/contracts/bridge.ts` — run sessions, outcome,
  reporting, the `risky` and `targets` flags, `readsEverySlot`, the main state members (01, 03).
- `src/shared/plugin-part-harness.test-support.ts`, `src/shared/plugin-catalog/manifest.test-support.ts` — the harness
  and the every-field manifest (01, 03); `src/shared/define-plugin.ts` — `readsEverySlot` (03).
- `src/shared/command-registry.ts`, `src/shared/command-router.ts`, `src/shared/runtime-commands.ts`,
  `src/main/page-commands.ts`, `src/preload/preload.ts`, `src/renderer/renderer.ts`, `src/main/main.ts` — the run's
  sessions and errors across the hop (01).
- `src/shared/plugin-catalog/validate-manifest.ts`, `src/shared/plugin-catalog/manifest-schema.ts` — `risky` and
  `targets` (01), `readsEverySlot` (03).
- `src/shared/state/slot-store.ts`, `src/main/plugins/main-api.ts` — `readAny`, `slotIds` (03).
- `src/plugins/forms/contract.ts`, `src/plugins/forms/main/start.ts` — `formsMainKey`, `confirm` (02).
- Risky and target manifests (04); target resolvers (05); chat main and chat's flags (06); chat page and layout (07).
- `src/plugins/manifests.ts`, `src/plugins/main.ts` — register `agent-commands` (08).

New files:

- `src/plugins/forms/main/confirm.ts` — the confirm round's args and the answer read, apart from forms' start (02).
- `src/plugins/chat/agent-frame.ts` — the frame line both chat parts share, as `image-rules.ts` is shared (06).
- `src/plugins/agent-commands/manifest.ts`, `main/start.ts`, `main/tools.ts`, `main/drive-actions.ts` — the plugin (08).

Shared names (exact; every task that uses one uses this spelling):

- `src/contracts/commands.ts`: `interface CommandSessions { readonly targetSessionId?: string; readonly
  callerSessionId?: string }` · `interface CommandRunOptions { readonly reportErrors?: true }` · `interface CommandHop
  extends CommandSessions, CommandRunOptions {}` · `type CommandOutcome = 'ran' | 'skipped'`
- `src/contracts/plugin.ts`: `CommandDecl.risky?: true` · `CommandDecl.targets?: true` · `PageCommandContext<A> extends
  CommandSessions` · `MainCommandContext<A> extends CommandSessions` · `PluginCommands.runFor(id: CommandId, arg: unknown,
  sessions: CommandSessions): Promise<CommandOutcome>` · `PluginCommands.list(): readonly CommandInfo[]` · `PluginManifest.readsEverySlot?:
  true` · `MainPluginState<M> extends PluginState<M, 'main'>` with `readAny(id: string): SlotSnapshot | undefined` and
  `slotIds(): readonly string[]`
- `src/shared/state/slot-store.ts`: `mainPluginState(store, manifest, track): MainPluginState<M>` · `SlotStore.snapshotOf(id)`
  · `SlotStore.ids()`
- `src/plugins/forms/contract.ts`: `interface ConfirmRequest { title: string; detail: string }` · `interface
  FormsMainExports { confirm(sessionId: string, request: ConfirmRequest, signal: AbortSignal, toolUseId: string | null):
  Promise<boolean> }` · `formsMainKey: DependencyKey<FormsMainExports, 'main', 'forms'>`
- `src/plugins/chat/agent-frame.ts`: `frameAgentMessage(senderName: string, text: string): string` ·
  `readAgentFrame(text: string): { from: string; body: string } | null` · `frameSenderName(title: string | null, label:
  string | null, sessionId: string): string`
- `src/plugins/chat/contract.ts`: `ChatMainExports.isUnattended(sessionId: string): boolean` ·
  `ChatMainExports.senderName(sessionId: string): string`
- The frame line, verbatim: `[Message from the agent in session "<name>" — not typed by the user]`, then `\n`, then
  the text. The dash is U+2014.

Boundary rules:

- `agent-commands` imports only `src/contracts`, `src/shared`, its own folder, and the `contract.ts` of `sessions`,
  `chat` and `forms` (its `dependsOn.main`).
- Only `agent-commands` calls `runFor`, `readAny` and `slotIds` in this plan.
- No harness knowledge enters these files: the frame line is chat's text, not a harness field.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

Critical path: 01 → 06 → 08 → 09

### Wave 1
- [x] [Command run context](01-command-run-context.md)
- [x] [Forms confirm export](02-forms-confirm.md)

### Wave 2
- [x] [Read any slot](03-read-any-slot.md) — after 01
- [x] [Risky and target flags](04-risky-flags.md) — after 01
- [x] [Target-capable commands read the target](05-target-resolvers.md) — after 01
- [x] [chat.sendTo and the frame line](06-chat-send-to.md) — after 01

### Wave 3
- [x] [The "from" tag](07-from-tag.md) — after 05, 06
- [x] [agent-commands plugin](08-agent-commands-plugin.md) — after 01, 02, 03, 06

### Wave 4
- [x] [Doc re-read](09-doc-re-read.md) — after 01–08
- [ ] [Final verification](10-final-verification.md)

## Run log

Review base: 8d829c42c

### Groups
- 01 · deep (compile error → same-rung fix dispatch) · fa8146889 · diff read: every Produces present (contracts/commands.ts, plugin.ts, bridge.ts, registry, router, page-commands, harness hop); wave-1 typecheck passes after 6b-fix commit · concerns: runFor casts sessions as Omit<Context,'arg'>; commandHopOf has no direct test (only the router row); edits outside Files: test fakes resolve 'ran', base-kit runLogged takes Promise<unknown>
- 02 · deep · db66ef045 · diff read: ConfirmRequest, FormsMainExports, formsMainKey in forms/contract.ts; confirmRoundArgs, confirmAllowed, askConfirm in forms/main/confirm.ts; wave-1 typecheck passes · concerns: start tests fake the sessions part; an empty title fails the round parser so confirm rejects (08 keeps titles non-empty); test nonces share the id counter
- 03 · hard · 8765648f6 · diff read: readsEverySlot on PluginManifest and definePlugin, MainPluginState with readAny/slotIds, MainApi.state, SlotStore snapshotOf/ids, mainPluginState; wave-2 typecheck passes · concerns: mainPluginState casts pluginState(...) to PluginState<M,'main'> (compiles); manifest-schema.test.ts reads validManifest() and belongs in the gate pick
- 04 · standard · f1c02b55b · diff read: every risky/targets flag in the task's table, counts checked against it; wave-2 typecheck passes · concerns: single-line declarations expanded to multi-line for the flag
- 05 · hard · 60da2181a · diff read: chat sessionFor, sessions closeSession/renameSession, workflow and Large runOnSelected act on targetSessionId; wave-2 typecheck passes · concerns: the task named sessions.active, the code uses sessions.shownSessionId(); sessions' rename test sees the dialog only through renameAccept; the Large target row uses b with s1 selected
- 06 · hard · 11db446db · diff read: frameAgentMessage, readAgentFrame, frameSenderName in chat/agent-frame.ts; chat.sendTo in the manifest (runsIn main, arg sessionId/text); isUnattended and senderName on ChatMainExports; wave-2 typecheck passes · concerns: sendTo needed a label and group (label: send a message to another session, framed as its agent's; group chat); the 'running target' test row is the likeliest to fail; the fake sessions gained label and the harness exposes titles/labels
- 07 · standard (compile error → same-rung fix) · 113ffce7a · diff read: from on UserInput and QueuedMessageInput in layout.d.ts; entryInput, queuedInput, stopText, putBack read the frame; layout.js draws the chat-user-from Tag; wave-3 typecheck passes after the read-chat-layout fix · concerns: the worker looked for DESIGN.md under docs/ and read no § Chat (it is at wigley-ai-gui/DESIGN.md); the putBack comment line runs past the wrap width
- 08 · deep · 0b157af9d · diff read: agentCommandsManifest (readsEverySlot, depends on sessions/chat/forms), agentCommandsMainPart, AGENT_COMMAND_TOOLS and createAgentCommandTools, drive actions call/result; refusal order matches the task; wave-3 typecheck passes · concerns: chat.sendTo is a string literal in tools.ts (no command key in chat's contract); the confirm detail lands in the round's overview, documented as inline markdown, so the fenced JSON argument may render badly (task 10 looks); keyed-slot JSON puts all-digit keys first (Object.fromEntries)
- 09 · standard · 995d667e9 · diff read: every planned mark for this feature gone; grep -in 'planned|not built yet' has no hit naming it and grep -c plan-agent-commands prints 0 in each of the four docs · concerns: AGENTS.md was read by section, not in full; the edited lines were not re-wrapped to the 120-column prose width
### Contract changes
- 01 adds `commandHopOf(value: unknown): CommandHop` in `src/shared/command-args.ts`: it reads a hop the other process sent, keeping only the two session-id strings and `reportErrors: true`. Consumers: none outside 01.
### Rulings
- Preflight: the relay hello now carries row_id (Lane H, 6fb763cb3, merged after plan time), so the plan-time precondition "no row id" is stale; nothing in 01-08 rests on it, and 09 checks AGENTS.md § Architecture relay paragraph against the row-id join — lead
- 01: plugin-facing PluginCommands.run still resolves Promise<void> (~15 call sites pass it as () => Promise<void>); the outcome comes from runFor · group 01
- 01: a run resolves 'ran' only when onDidRun would fire; a failed run that does not report resolves 'skipped' · group 01
- 01: pageGone logs every waiting run, reporting runs included · group 01
- 02: an answer marked dont_ask counts as a denial even on choice 1 · group 02
- 02: a newer tool session of the same app id replaces the map entry; the older one's end only removes its own entry · group 02
- 02: askConfirm returns true for this round's Allow even when the signal aborted after; 08 checks signal.aborted before running a risky command · group 02
- 03: SlotStore.ids() itself sorts in code-unit order and slotIds() returns it unchanged, satisfying both the Tests line and the Decisions line · group 03
- 04: docs.confirmYes is also flagged risky (lead ruling): it is the step that moves the file to the Trash, and the rule flags every route; notes already flags both discard and confirmYes · group 04
- 05: renameSession with a target checks the row before showing Sessions mode, so an unknown target logs 'no session to rename' and leaves the mode alone · group 05
- 06: the unknown-target refusal checks holds() directly, so it throws the task's exact text and also refuses the layout preview's session · group 06
- 06: firstMessageTitleOf titles a framed message from its body, on send and on resume · group 06
- 07: in a pending row the Tag sits between the label and the text · group 07
- 08: an Allow after the call's signal aborted counts as a denial (tested) · group 08
- 08: call arguments that are not an object return 'arguments must be an object' · group 08
- 08: a drive call that rejects is stored as an error result · group 08
- 08: the 'no drive actions when api.drive is null' row is dropped, as no assertion can fail in the harness; start.test.ts checks both actions are added with drive on · group 08
- Review round 1, headless auto-picks: a targeted closeSession closes at once; the confirm overview is the detail's first paragraph; docs.conflictOverwrite is risky; chat.denyPermission, denyEntry and submitReason stay not risky; the commandRunDone reply is guarded; a frame line typed by the user still reads as framed (the user is trusted). Pre-existing finding 23 dismissed: sessions' consumer view tracks every contributeTools disposable (consumer-view.ts:47-48), so the worker's hunk was reverted.
### Review rounds
- Round 1 (pinned d6ac75086): NEEDS FIXES, 22 findings plus 1 pre-existing; report review-d6ac75086.md. Fix range 2c29d234f..103c6d76a (5 worker commits), compile passes. Tier: Medium, because behaviour crosses modules (the confirm overview between forms and agent-commands; a targeted closeSession through chat's close guard; the page-reply guard at the IPC boundary). No shared contract shape changed. A correctness re-review runs on the fix commits; the tests wait for the gate.
### Test gate
