# Agent commands

**Contents**

- **Status** — what is built.
- **What it is** — the three tools, and why commands are the one surface.
- **The tools** — `list_commands`, `run_command` and `read_state`: arguments and replies.
- **The run's sessions** — the target a run acts on, the caller that asked, and the commands that take a target.
- **Errors** — what a reporting run rejects with, across the page hop, and what `Ran` means.
- **Risky commands** — the rule, the set, the confirm, and the headless refusal.
- **Sending to another session** — `chat.sendTo`, the frame line and the "from" tag.
- **Reading any slot** — the main API member behind `read_state`.
- **Decisions** — choices a future change would otherwise reopen.
- **Out of scope**

An agent connected to the app can do any action the user can do in the live app, such as sending a message into
another session for the user, because every app action is a command. A good outcome: the user says "send 'run the
tests' to gamma 2" and the agent finds the row, sends the text, and the target chat shows who sent it.

## Status

Built.

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
| `list_commands` | `filter?: string` | JSON array of `{ id, label, group, runsIn, arg?, risky?, targets? }`, sorted by id: every command the main and page catalogs and the served config hold, one entry per id; a stale runtime entry of an old page is left out. `filter` keeps the entries whose id, label or group holds it, case ignored |
| `run_command` | `command: string`, `arg?: any JSON`, `session?: string` | `Ran <id>.` when the handler finished without an error; `Skipped <id>: an intercept did not run it.` when an intercept kept the handler from running; an error result with the failure or refusal text otherwise |
| `read_state` | `slot?: string`, `key?: string` | no `slot`: JSON array of every slot id, sorted. `slot`: the value of a value slot (`null` when unset), an object of `key: value` for a keyed slot, an array of `[key, items]` pairs in first-set order for a list slot. `key`: that one entry, or for a list slot that key's items. An unknown slot or entry is an error result |

`session` is the app's session id of a row (`SessionRow.sessionId` in `sessions.rows`), the session the command acts
on in place of the focused one. Only a command declared `targets: true` takes one. A `session` for any other command,
or one that names no row in `sessions.rows`, is an error result, and nothing runs.

`Ran` never proves the effect: a command that finds nothing to act on logs and does nothing, and a command returns no
result. The agent reads the effect with `read_state`. The tool's description says so.

The worked case: the user says "send 'run the tests' to gamma 2". The agent calls `read_state { slot:
"sessions.rows" }`, finds the row whose label or title is `gamma 2`, then calls `run_command { command:
"chat.sendTo", arg: { sessionId, text: "run the tests" } }`.

## The run's sessions

Each run carries two optional session ids, beside its argument (`CommandSessions` in `src/contracts/commands.ts`):

- **`targetSessionId`** — the session the command acts on.
- **`callerSessionId`** — the session whose agent asked for the run. `chat.sendTo` names the sender from it.

Both reach the handler on `PageCommandContext` and `MainCommandContext`, and cross the page hop both ways. A key or
a click carries neither.

**Target-capable commands.** `CommandDecl.targets?: true` marks a command that acts on a given session without that
session's UI shown or focused. Only such a command reads the target; `runFor` and `run_command` refuse a target for
any other. The set:

- **chat** — `send`, `sendNow`, `interrupt`, `allowOrCopy`: the target's chat session, whichever tab shows.
- **sessions** — `closeSession` and `renameSession`: the target's row. A target passes the Sessions-mode-shown guard;
  `renameSession` shows Sessions mode, since its dialog waits on the user's typing. A targeted `closeSession` skips the
  session's end-session confirm, since the agent's run already asked the user, but main still refuses a session an
  open form holds.
- **workflow** — `mainAction`, `toggleHeadless`, `cancelCountdown`, and each declared action, registered as
  `workflow.<workflow id>-<action id>` (the sample Large's `wigley-large-clearAndMake`, `-makeInNewSession`,
  `-resumeMake`, `-retro`, `-dismiss`): the stage action runs for the target.

Every other command — one that opens a UI over the user's view, moves focus, or acts on a cursor, pane or list — takes
no target. Run without `session`, it acts as a key does.

## Errors

`api.commands.runFor(id, arg, sessions)` is a reporting run. It rejects with the failure for:

- an unknown id, a bad argument, no handler, or a target for a command without `targets`
- a handler or wrap that throws or rejects (the first failure in time)
- no started page, and a page that goes before the run settles

Every other run — keys, clicks, `api.commands.run` — keeps the old rule: a failure is logged under its owner and the run
resolves, with no value for a plugin's plain `api.commands.run`. The core router's and registry's runs and `runFor`
resolve `'ran'` or `'skipped'`. A page command run from main sends its outcome and error text back with the done
message (`bridge:command-run-done`), so a main caller hears a page handler's failure.

A workflow stage command runs its stage action through the key runner, so a failure inside the stage action stays
log-only: the command's handler finishes and `run_command` answers `Ran`.

## Risky commands

`CommandDecl.risky?: true` marks a command risky, in its own manifest declaration (a runtime command's declaration
too). `list_commands` shows the flag. The rule: a command is risky when it destroys or discards user state the app
cannot give back, closes or stops a session, installs or restarts, opens something outside the app, or approves or
answers on the user's behalf. Every route to such an action is flagged, a generic command that reaches it included.
The set:

- `app-update.install`, `app-update.pressButton`
- `sessions.closeSession`, `sessions.listClose`, `sessions.closePane`, `session-stash.noteAccept`
- `chat.stopAll`, `chat.endSession`, `chat.allowOrCopy`, `chat.allowEntry`, `chat.removeImage`, `chat.removeImageAt`,
  `chat.removeShownImage`
- `docs.trash`, `docs.conflictReload`, `docs.conflictOverwrite`, `docs.confirmYes`, `docs.answerConfirm`
- `notes.remove`, `notes.removeSession`, `notes.removeImageAt`, `notes.discard`, `notes.confirmYes`
- `settings.reset`, `settings.removeBind`
- `workflow.mainAction`, `workflow.stageAction`, and each declared action marked `risky` (the sample Large's `workflow.wigley-large-clearAndMake` and `workflow.wigley-large-resumeMake`)
- `forms.submit`, `forms.confirmCancel`, `primer.submit`, `primer.confirmCancel`, `audio-picker.submit`,
  `audio-picker.confirmCancel`
- `unity-pool.open`, `live-view.openScreenSettings`, `core.openLink`
- `core.reloadPlugin`

`chat.send`, `chat.sendTo` and `chat.interrupt` are not risky. Neither are `chat.denyPermission`, `chat.denyEntry`
and `chat.submitReason`, since a deny is the safe direction.

A risky command run by `run_command` asks the user first, through the `forms` main export `confirm`: a round over the
calling session's tabs, as `ask_round` shows, or, for a caller with no tab (a terminal session), its row marked as a
round marks it. The round has one question, Allow or Deny, with Deny recommended, so a stray Enter and the headless
auto-answer never allow. Every confirm is a fresh round: a per-call nonce in its question title keeps the forms service
from replaying an earlier answer or pre-picking a saved choice. The command runs only on a submitted Allow of that
round; a cancel, a host abort or any other outcome is a denial, and `run_command` answers `The user denied <id>.` A
deadline's draft re-opens the same round. A confirm that fails (no forms session for the caller) refuses the command
with its error text. While a confirm waits, `run_command` refuses every `forms.*` command, so no agent picks Allow for
the user. The round is saved with the session's other rounds.

A risky command from a headless or unattended session is refused at once, with a reason the agent reads, and no
round opens: nobody answers that session.

## Sending to another session

`chat.sendTo { sessionId: 'string', text: 'string' }` runs in main and sends `text` to the session through chat's
`send`, queued while that session's turn runs, as any send is. It refuses, in this order, an empty text, the caller's
own session, and a session chat does not hold. It never runs an app slash command: `/clear` and `/login` live in the
page, and `sendTo` goes through main's `send`.

A run with a caller — an agent's — opens the text with one frame line, so the target agent knows the user did not
type it:

```
[Message from the agent in session "<name>" — not typed by the user]
<text>
```

`<name>` is the caller's title as the rename dialog fills it (`editableTitle`), else its side-bar label, else its id:
each whitespace run collapsed to one space, trimmed, capped at 80 characters with a trailing `…`, and `\` and `"`
escaped. A run with no caller (a user's key or click) sends the text as typed.

The chat page draws a neutral Tag `from <name>` over the rest of the text on the entry and on a pending row. A copy, a
range and the box take the message body without its frame line, and no Tag. The Tag comes from the message text
itself, so it survives a transcript rebuild on resume. A first message sent this way,
or resumed, titles the row from the text after the frame line.

## Reading any slot

The main API's `state` gains `readAny(id)` and `slotIds()`, for a plugin whose manifest declares
`readsEverySlot: true`; any other plugin's call throws. `readAny` returns the slot's snapshot (`SlotSnapshot`) or
undefined. Main holds every slot, page-owned ones included, so `read_state` reads `sessions.active` and the chat page's
slots too. `agent-commands` is the one built-in that declares it.

## Decisions

- **Commands stay the one surface.** A new agent ability is a new command, so the tool schemas never change.
- **Target on the run, not in the argument.** A command's one argument stays its own; a session field in every
  argument would change every focus-bound command's declaration.
- **Targets are declared, not guessed.** A command that needs its UI shown would act on a hidden view or steal focus,
  and a risky one that ignored the target would be confirmed for the wrong session; so a command takes a target only
  when its declaration says so.
- **Confirm the risky few.** Every other command runs at once; a flag on the declaration keeps the set beside the
  command it marks.
- **Framed text, not a side field.** The tag is drawn from the message's first line, so it outlives the live entry;
  a side map keyed by entry id breaks when a resume rebuilds the ids.
- **Reporting is opt-in.** Keys and clicks keep log-and-resolve, so no key path learns a new failure.
- **A manifest flag for reading every slot.** A built-in has no more reach than a user plugin would, so the reach is
  a declaration any plugin can make, never a list of plugin ids in the core.

## Out of scope

- Aiming a command that needs its own UI open (`forms.*`, `picker.*`) at another session: run without `session`, it
  acts on the user's shown UI, as a key does.
- An auth token on the relay: any local process that can say hello can call the tools, as before.
- Quitting the app and git operations: no command does either.
