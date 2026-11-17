# Agent commands

**Contents**

- **Status** — what is built.
- **What it is** — the three tools, and why commands are the one surface.
- **The tools** — `list_commands`, `run_command` and `read_state`: arguments and replies.
- **The run's sessions** — the target a run acts on, the caller that asked, and the commands that read them.
- **Errors** — what a reporting run rejects with, across the page hop.
- **Risky commands** — the flag, the set, the confirm, and the headless refusal.
- **Sending to another session** — `chat.sendTo`, the frame line and the "from" tag.
- **Reading any slot** — the main API member behind `read_state`.
- **Decisions** — choices a future change would otherwise reopen.
- **Out of scope**

An agent connected to the app can do any action the user can do in the live app, such as sending a message into
another session for the user, because every app action is a command. A good outcome: the user says "send 'run the
tests' to gamma 2" and the agent finds the row, sends the text, and the target chat shows who sent it.

## Status

Planned in `plan-agent-commands`, not built yet. Every behaviour below is the plan's target; until the plan's code
lands, the app has none of the three tools, no `risky` flag, no `chat.sendTo` and no run target.

## What it is

The `agent-commands` plugin (main only) contributes three MCP tools to every session the app's relay connects, through
the `sessions` export `contributeTools`: `list_commands`, `run_command` and `read_state`. Terminal sessions and
subagents may call them too (not main-agent-only): the risky confirm is the gate.

New agent abilities arrive as commands, never as new tools. The three schemas never change, so a running session never
needs a restart for a new ability: Claude Code caches a session's tool schemas when the session starts, so a new tool
reaches only sessions started after the app update.

## The tools

| Tool | Arguments | Reply |
|---|---|---|
| `list_commands` | `filter?: string` | JSON array of `{ id, label, group, runsIn, arg?, risky? }`, sorted by id: every command of the served config and both runtime catalogs, one entry per id. `filter` keeps the entries whose id, label or group holds it, case ignored |
| `run_command` | `command: string`, `arg?: number \| string \| object`, `session?: string` | `Ran <id>.` on success; an error result with the failure text otherwise |
| `read_state` | `slot?: string`, `key?: string` | no `slot`: JSON array of every slot id, sorted. `slot`: the value of a value slot, an object of `key: value` for a keyed slot, an object of `key: items` for a list slot. `key`: that one entry. An unknown slot is an error result |

`session` is the app's session id of a row (`SessionRow.sessionId` in `sessions.rows`), the session the command acts
on in place of the focused one. A `session` that names no row in `sessions.rows` is an error result, and nothing runs.

A command that finds nothing to act on logs and does nothing, and `run_command` still answers `Ran <id>.`: a command
returns no result. The agent reads the effect with `read_state`.

The worked case: the user says "send 'run the tests' to gamma 2". The agent calls `read_state { slot:
"sessions.rows" }`, finds the row whose label or title is `gamma 2`, then calls `run_command { command:
"chat.sendTo", arg: { sessionId, text: "run the tests" } }`.

## The run's sessions

Each run carries two optional session ids, beside its argument (`CommandSessions` in `src/contracts/commands.ts`):

- **`targetSessionId`** — the session the command acts on. Every command that resolves "the visible or focused
  session" reads the target first, so a focus-bound command is aimable without moving the user's view.
- **`callerSessionId`** — the session whose agent asked for the run. `chat.sendTo` names the sender from it.

Both reach the handler on `PageCommandContext` and `MainCommandContext`, and cross the page hop both ways. A key or
a click carries neither.

The commands that read the target:

- **chat** — every command `inSession` or `inRunningSession` wraps (send, sendNow, focusBox, interrupt, the entry
  moves and scrolls, the permission keys, the controls): the target's chat session, whichever tab shows.
- **sessions** — `closeSession`, `renameSession`, `togglePopup`, `nextTab` and `prevTab`, `favoriteProject`,
  `moveProjectUp` and `moveProjectDown`: the target's row. A target passes the Sessions-mode-shown guard. With a
  target, `togglePopup`, `nextTab` and `prevTab` leave the shown mode as it is; `renameSession` shows Sessions mode,
  since its dialog waits on the user's typing.
- **workflow** and **workflow-large** — every stage action command run on the selected session: the target.

Pane commands (split, swap, close the pane, resize, focus) and the side bar's list commands act on the user's layout,
not on a session, and ignore a target.

## Errors

`api.commands.runFor(id, arg, sessions)` is a reporting run: it rejects with the failure for an unknown id, a bad
argument, no handler, a handler or wrap that throws or rejects, no started page, and a page that goes before the run
settles. Every other run — keys, clicks, `api.commands.run` — keeps the old rule: a failure is logged under its owner
and the run resolves. A page command run from main sends its error text back with the done message
(`bridge:command-run-done`), so a main caller hears a page handler's failure.

## Risky commands

`CommandDecl.risky?: true` marks a command risky, in its own manifest declaration (a runtime command's declaration
too). `list_commands` shows the flag. The set:

- `app-update.install`
- `sessions.closeSession`, `sessions.listClose`, `sessions.closePane`
- `chat.stopAll`, `chat.allowOrCopy`, `chat.allowEntry`
- `docs.trash`
- `notes.remove`, `notes.removeSession`
- `settings.reset`
- `workflow-large.clearAndMake`, `workflow-large.resumeMake`
- `core.reloadPlugin`, `core.openLink`

`chat.send` and `chat.sendTo` are not risky.

A risky command run by `run_command` asks the user first, through the `forms` main export `confirm`: a round over the
calling session's tabs, as `ask_round` shows, or, for a caller with no tab (a terminal session), its row marked as a
round marks it. The round has one question, Allow or Deny, with Deny recommended, so a stray Enter and the headless
auto-answer never allow. The command runs only on a submitted Allow; a cancel, a host abort or any other outcome is a
denial, and `run_command` answers `The user denied <id>.` A deadline's draft waits on, as `collect_last_round` would.
The round is saved with the session's other rounds.

A risky command from a headless or unattended session is refused at once, with a reason the agent reads, and no
round opens: nobody answers that session.

## Sending to another session

`chat.sendTo { sessionId: 'string', text: 'string' }` runs in main and sends `text` to the session through chat's
`send`, queued while that session's turn runs, as any send is. It refuses an empty text, a session chat does not hold,
and the caller's own session.

A run with a caller — an agent's — opens the text with one frame line, so the target agent knows the user did not
type it:

```
[Message from the agent in session "<name>" — not typed by the user]
<text>
```

`<name>` is the caller's title as the rename dialog fills it (`editableTitle`), else its side-bar label. A run with no
caller sends the text as typed.

The chat page draws a user entry whose text opens with that exact line as a neutral Tag `from <name>` over the rest of
the text. The tag comes from the message text itself, so it survives a transcript rebuild on resume. A first message
sent this way titles the row from the text after the frame line.

## Reading any slot

The main API's `state` gains `readAny(id)` and `slotIds()`, for a plugin whose manifest declares
`readsEverySlot: true`; any other plugin's call throws. `readAny` returns the slot's snapshot (`SlotSnapshot`) or
undefined. Main holds every slot, page-owned ones included, so `read_state` reads `sessions.active` and the chat page's
slots too. `agent-commands` is the one built-in that declares it.

## Decisions

- **Commands stay the one surface.** A new agent ability is a new command, so the tool schemas never change.
- **Target on the run, not in the argument.** A command's one argument stays its own; a session field in every
  argument would change every focus-bound command's declaration.
- **Confirm the risky few.** Every other command runs at once; a flag on the declaration keeps the set beside the
  command it marks.
- **Framed text, not a side field.** The tag is drawn from the message's first line, so it outlives the live entry;
  a side map keyed by entry id breaks when a resume rebuilds the ids.
- **Reporting is opt-in.** Keys and clicks keep log-and-resolve, so no key path learns a new failure.
- **A manifest flag for reading every slot.** A built-in has no more reach than a user plugin would, so the reach is
  a declaration any plugin can make, never a list of plugin ids in the core.

## Out of scope

- Commands that need their own UI open (`forms.*`, `picker.*`): they do nothing without it.
- An auth token on the relay: any local process that can say hello can call the tools, as before.
- Quitting the app and git operations: no command does either.
