# Agent commands — plan

Feature: agent commands · Implements: none · Ticket: none
Target: `main` · Written: 2026-11-17

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

An agent connected to the live app runs any app command and reads any app state, through three MCP tools that never
change shape: `list_commands`, `run_command` and `read_state`. A run aims a focus-bound command at any session without
moving the user's view. A risky command asks the user Allow or Deny first. `chat.sendTo` sends text into another
session, framed so the target agent and the user see which session's agent sent it.

## Architecture

Systems touched, all in `wigley-ai-gui/`:

- **Core commands** (`src/contracts/`, `src/shared/command-*.ts`, `src/shared/runtime-commands.ts`,
  `src/main/page-commands.ts`, `src/preload/`, `src/renderer/renderer.ts`, `src/main/main.ts`): the run context carries
  `targetSessionId` and `callerSessionId`; a reporting run rejects with its failure; `commands.list()`; the `risky`
  flag on `CommandDecl`.
- **Core state** (`src/shared/state/slot-store.ts`, `src/main/plugins/main-api.ts`): `readAny` and `slotIds` for a main
  part whose manifest declares `readsEverySlot`.
- **Plugins**: `forms` (the `confirm` export), `chat` (`chat.sendTo`, the frame line, the "from" tag, `isUnattended`,
  focus resolvers), `sessions`, `workflow`, `workflow-large` (focus resolvers), the manifests of the risky set, and the
  new main-only plugin `agent-commands`.

The design doc is `wigley-ai-gui/docs/features/agent-commands/design.md`. Every copy, format and set in it is pinned.

## Preconditions

Each claim was checked at plan time, on tip `34e478234` (the docs commit `fb0ca6b01` sits on it). Run each command from
the `ai` worktree root; `wigley:make` runs them again before the first dispatch.

| Claim | Command | Result at plan time |
|---|---|---|
| The relay hello carries the host session id and no row id | `grep -c '"session_id"' wigley-ai-marketplace/plugins/wigley/scripts/forms/relay.py; grep -rln 'WIGLEY_SESSION_ROW\|SESSION_ROW_ENV' wigley-ai-marketplace/plugins/wigley/scripts/forms wigley-ai-gui/src/plugins/sessions \| wc -l` | `1`, then `0` |
| No `risky` field exists yet | `grep -c risky wigley-ai-gui/src/contracts/plugin.ts wigley-ai-gui/src/shared/plugin-catalog/validate-manifest.ts` | `0` each |
| No run target, caller or reporting run exists yet | `grep -c 'targetSessionId\|callerSessionId\|runFor' wigley-ai-gui/src/contracts/plugin.ts wigley-ai-gui/src/contracts/commands.ts wigley-ai-gui/src/shared/command-router.ts` | `0` each |
| The page's done message carries only the request number | `grep -n 'commandRunDone, request)' wigley-ai-gui/src/preload/preload.ts` | line 81 |
| Forms' main part exports nothing | `grep -c exports wigley-ai-gui/src/plugins/forms/main/start.ts` | `0` |
| No `agent-commands` plugin exists | `test ! -e wigley-ai-gui/src/plugins/agent-commands && echo absent` | `absent` |
| Chat has no `sendTo` and no `isUnattended` | `grep -c 'sendTo\|isUnattended' wigley-ai-gui/src/plugins/chat/manifest.ts wigley-ai-gui/src/plugins/chat/contract.ts` | `0` each |
| `autoClearAndMake` is a setting, not a command; `clearAndMake` and `resumeMake` are commands | `grep -c autoClearAndMake wigley-ai-gui/src/plugins/workflow-large/stages/index.ts; grep -n 'clearAndMake:\|resumeMake:' wigley-ai-gui/src/plugins/workflow-large/stages/index.ts` | `0`, then lines 59 and 74 |
| No by-id slot read exists in the plugin API | `grep -c 'readAny\|readsEverySlot\|slotIds' wigley-ai-gui/src/contracts/plugin.ts wigley-ai-gui/src/shared/state/slot-store.ts` | `0` each |
| Every plugin command of the risky set is declared | `for p in app-update:install sessions:closeSession sessions:listClose sessions:closePane chat:stopAll chat:allowOrCopy chat:allowEntry docs:trash notes:remove notes:removeSession settings:reset; do grep -q "^    ${p##*:}: {" wigley-ai-gui/src/plugins/${p%%:*}/manifest.ts && printf '%s ok, ' $p; done` | 11 `ok` |
| The core declares `core.openLink` and `core.reloadPlugin` | `grep -c 'CORE_OPEN_LINK.id\|CORE_RELOAD_PLUGIN.id' wigley-ai-gui/src/config/keymap.ts` | `2` |

## Docs written ahead

Commit `fb0ca6b01`:

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
        agent-commands: info = commands.list() entry; not risky
        commands.runFor('chat.sendTo', arg, { callerSessionId: caller.id })
          └▶ router (main) ─▶ chat main sendTo handler
               └▶ chat.send(target, { text: frame line + "\n" + text, images: [] })
        ◀── "Ran chat.sendTo." ───────────────
target chat page: entry text opens with the frame line ─▶ UserInput.from = caller name ─▶ layout draws Tag "from <name>"

risky case:
run_command {command: docs.trash}
  caller headless or unattended ─▶ error result, nothing runs
  else forms.confirm(caller.id, {title, detail}, signal, toolUseId)
       ─▶ a round over the caller's tabs, or the caller's row marked
       Allow ─▶ commands.runFor(...) ; anything else ─▶ "The user denied docs.trash."

page command run from main with a target:
  router.run(id, arg, {targetSessionId, callerSessionId}, {reportErrors: true})
    ─▶ remote(id, arg, hop) ─▶ page-commands ─▶ commandRunInPage(request, id, arg, hop)
    ─▶ preload ─▶ renderer router.run(id, arg, sessions, {reportErrors})
    ─▶ handler reads context.targetSessionId first
    ◀── commandRunDone(request, errorText | null) ─▶ reject when errorText and the run reports
```

Decisions (from the interview and the design review; each binds every task):

- Target on the run: `run_command` takes an optional `session`; every command that resolves the visible or focused
  session reads `targetSessionId` first (round 1).
- One new command `chat.sendTo {sessionId, text}`; `chat.send` keeps sending the composer box (round 1).
- Confirm the risky few, flagged on the command's own declaration (round 2).
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
- The confirm recommends Deny, so a stray Enter and the headless auto-answer never allow (Decided at plan time).
- The risky set swaps `workflow-large.autoClearAndMake` (a setting, not a command) for `workflow-large.clearAndMake` and
  `workflow-large.resumeMake`, and adds `chat.allowOrCopy` and `chat.allowEntry`, which grant another session's tool
  permission (Decided at plan time).
- `read_state` takes an optional `slot` (absent lists the slot ids) and an optional `key`; `list_commands` takes an
  optional `filter` (Decided at plan time).
- `run_command` refuses a `session` that names no row in `sessions.rows` (Decided at plan time).
- A drive run calls the tools through `agent-commands` drive actions, since the fake harness calls no MCP tool (Decided
  at plan time).

Out of scope: commands that need their own UI open (`forms.*`, `picker.*`); an auth token on the relay; app quit and git
operations, which no command does.

## File Structure

Paths under `wigley-ai-gui/`.

Existing files modified:

- `src/contracts/commands.ts`, `src/contracts/plugin.ts`, `src/contracts/bridge.ts` — run sessions, reporting, the
  risky flag, `readsEverySlot`, the main state members (01, 03).
- `src/shared/command-registry.ts`, `src/shared/command-router.ts`, `src/shared/runtime-commands.ts`,
  `src/main/page-commands.ts`, `src/preload/preload.ts`, `src/renderer/renderer.ts`, `src/main/main.ts` — the run's
  sessions and errors across the hop (01).
- `src/shared/plugin-catalog/validate-manifest.ts`, `src/shared/plugin-catalog/manifest-schema.ts` — `risky` (01),
  `readsEverySlot` (03).
- `src/shared/state/slot-store.ts`, `src/main/plugins/main-api.ts` — `readAny`, `slotIds` (03).
- `src/plugins/forms/contract.ts`, `src/plugins/forms/main/start.ts` — `formsMainKey`, `confirm` (02).
- Risky manifests (04); focus resolvers (05); chat main (06); chat page and layout (07).
- `src/plugins/manifests.ts`, `src/plugins/main.ts` — register `agent-commands` (08).

New files:

- `src/plugins/forms/main/confirm.ts` — the confirm round's args and the answer read, apart from forms' start (02).
- `src/plugins/chat/agent-frame.ts` — the frame line both chat parts share, as `image-rules.ts` is shared (06).
- `src/plugins/agent-commands/manifest.ts`, `main/start.ts`, `main/tools.ts`, `main/drive-actions.ts` — the plugin (08).

Shared names (exact; every task that uses one uses this spelling):

- `src/contracts/commands.ts`: `interface CommandSessions { readonly targetSessionId?: string; readonly
  callerSessionId?: string }` · `interface CommandRunOptions { readonly reportErrors?: true }` · `interface CommandHop
  extends CommandSessions, CommandRunOptions {}`
- `src/contracts/plugin.ts`: `CommandDecl.risky?: true` · `PageCommandContext<A> extends CommandSessions` ·
  `MainCommandContext<A> extends CommandSessions` · `PluginCommands.runFor(id: CommandId, arg: unknown, sessions:
  CommandSessions): Promise<void>` · `PluginCommands.list(): readonly CommandInfo[]` · `PluginManifest.readsEverySlot?:
  true` · `MainPluginState<M> extends PluginState<M, 'main'>` with `readAny(id: string): SlotSnapshot | undefined` and
  `slotIds(): readonly string[]`
- `src/plugins/forms/contract.ts`: `interface ConfirmRequest { title: string; detail: string }` · `interface
  FormsMainExports { confirm(sessionId: string, request: ConfirmRequest, signal: AbortSignal, toolUseId: string | null):
  Promise<boolean> }` · `formsMainKey: DependencyKey<FormsMainExports, 'main', 'forms'>`
- `src/plugins/chat/agent-frame.ts`: `frameAgentMessage(senderName: string, text: string): string` ·
  `readAgentFrame(text: string): { from: string; body: string } | null`
- `src/plugins/chat/contract.ts`: `ChatMainExports.isUnattended(sessionId: string): boolean`
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
- [ ] [Command run context](01-command-run-context.md)
- [ ] [Forms confirm export](02-forms-confirm.md)

### Wave 2
- [ ] [Read any slot](03-read-any-slot.md) — after 01
- [ ] [Risky flags](04-risky-flags.md) — after 01
- [ ] [Target resolvers](05-target-resolvers.md) — after 01
- [ ] [chat.sendTo and the frame line](06-chat-send-to.md) — after 01

### Wave 3
- [ ] [The "from" tag](07-from-tag.md) — after 06
- [ ] [agent-commands plugin](08-agent-commands-plugin.md) — after 01, 02, 03, 06

### Wave 4
- [ ] [Doc re-read](09-doc-re-read.md) — after 01–08
- [ ] [Final verification](10-final-verification.md)

## Run log

Review base: <sha, written by wigley:make at preflight>

### Groups
### Contract changes
### Rulings
### Review rounds
### Test gate
