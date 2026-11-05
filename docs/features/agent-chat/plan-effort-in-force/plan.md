# Effort in force — plan

Feature: agent chat · Implements: none · Ticket: none
Target: main · Written: 2026-11-04

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

The Session panel and the model · effort chip show the effort the Claude process uses. A new Opus 5.5 session shows `Opus · Medium`, and not `Opus · unset`.

## Architecture

The change stays in the Claude adapter, `src/main/claude-code/`. The adapter already reports each control through `AgentProcessEvents.controls`. The harness contract, chat and the layouts do not change.

## Preconditions

Run each command again before the first dispatch.

- `claude --version` prints 2.1.318 or later. A newer version: run the probe in `docs/features/agent-chat/claude-stream.md` § Effort once.
- `git status --short -- src/main/claude-code` prints nothing (true on 2026-11-04). Peer sessions edit this folder on `main`. If the command prints a file that Task 01 edits, tell the user and wait: a pathspec commit would carry the peer's hunks. If it prints nothing, continue.

## Docs written ahead

Commits: `3c08d6ad` and `a160537c`.

- `docs/features/agent-chat/claude-stream.md` § Effort
- `docs/features/agent-chat/design.md` § Controls bullet
- `AGENTS.md` § An agent harness

## Mandatory Reads

- `AGENTS.md`: § An agent harness, § A session control, § Running and testing
- `docs/features/agent-chat/claude-stream.md` § Effort
- `.agents/skills/drive/SKILL.md`, for Task 03

## Design Overview

```
process start ───────┐
attach, when owed ───┼─► get_settings ─► reply.applied ─► held model and effort ─► controls event ─► chip, Session panel
each turn end ───────┘                   (kept out of the chat)
```

A local command ends with a `result`, so `/effort` and `/model` are turn ends. One rule covers start, every command, and a default that changes with the model.

Decisions:

- **Source.** `get_settings` `applied`. The app does not keep a table of model defaults, because a table goes stale, and it does not parse `/model` text, because that adds a command to each turn.
- **The model too.** The reply also sets the model control. A new session then shows its model before the first message, where the init event has not arrived yet. `applied.model` does not follow plan mode's model switch, so the chip does not flip (`claude-stream.md` § Effort). `init.model` agrees with it.
- **A value outside the choices.** The held value is the raw string, as the init path does. `valueLabel` shows it raw, because the chip must show what the process uses.
- **No pinning.** Reported values stay out of `userSetControls`, so a later start does not pass them as `--model` or `--effort`. `confirmPicks` in `chat-sessions.ts` adds a control to that set only when a pending pick matches.
- **A pick of the shown value.** Today the held effort of a session with no pick is null, so each first pick changes it and a `controls` report confirms the pick. After this change, a pick of the default changes nothing. A successful `/effort` or `/model` command with a known value therefore always reports `controls`, so `confirmPicks` runs.
- **A reply that confirms a pick early.** A reply in flight can hold the picked value before the pick's command runs, or when the command then fails. This is accepted: the value is the value the process used, so a later `--effort` with it does no harm.
- **Seam.** The new reading follows the `get_context_usage` request: a pending request kind, an owed flag, and a fold effect. A replay of the pipe log rebuilds the values, with no write.
- **Owed at start of the fold.** `isSettingsRequestOwed` starts true, and `isContextRequestOwed` starts false. A process attached from a log with no `get_settings` line, from a build before this change, then gets one request at attach.

Out of scope:

- A chip for `applied.ultracode`.
- The word `unset` in `valueLabel`. It stays for a model with no effort and for the time before the first reply.

## File Structure

Modified:

- `src/main/claude-code/claude-controls.ts`: the reader of the reply's `applied` values
- `src/main/claude-code/session-fold.ts`: the pending kind, the owed flag, the reply's fold, the effect
- `src/main/claude-code/claude-code-harness.ts`: the request and its three triggers
- their test files

New files: none.

Boundary rule: nothing outside `src/main/claude-code/` names `get_settings`.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Read the applied settings](01-read-applied-settings.md)

### Wave 2
- [x] [Doc re-read](02-doc-re-read.md) — after 01

### Wave 3
- [x] [Final verification](03-final-verification.md) — after 02

## Run log

Review base: b05f0e7fa4316350df34560fcfcebfa982326d2e

### Groups
- 01 · 8175b432 · diff read: all four Produces present, Decisions matched; typecheck passes; worker ran lint and the four test files (569 passed) · concerns: same-value report also fires for a typed /effort with no pick (extra controls event, confirmPicks no-op); two tests passed on stale wigley-2 ids and moved to wigley-3; row name "request already written" now means the context request only; AGENTS.md module map names get_context_usage only
- 02 · dc3f68c6 · diff read: one row changed, three written-ahead passages true against 8175b432 · concerns: none
- 03 · dc3f68c6 · drive run effort-check on the real CLI: 5 of 5 checks pass, screenshots read by the driver, no model turn, spend 0.00, run quit; no commit of its own · concerns: check 4 kept Medium, the default, so keeping a non-default effort across /model was not exercised live; a brief unset in the log during new session, /effort auto and /clear; Mode shows unset on a new session until the first control reply
### Contract changes
### Rulings
- No test owned foldControlValues, so the same-value row is a new table foldPipeLine_ControlCommandResult_ReportsControls in session-fold.test.ts — the fold owns the rule — the row moves file if wrong · group 01 · group 01
- No chat-sessions test added: restart_StartCarriesHeldModeAndConfirmedPicks (ReportedOnly1mModelAndEffort) already fails if a report joins userSetControls — one row missing if wrong · group 01 · group 01
- Only /effort auto clears a control; any other command value outside the choices leaves the control and its pick alone — a probe shows Claude answers /effort hihg, /effort ultracode and /model nosuchmodel with subtype success and changes nothing — a typed /model best still shows through the reply and goes back to the pick at a restart · lead
### Review rounds
- 1 · 1047872c · NEEDS FIXES
- 2 · 96f0c3d6 · NEEDS FIXES (re-review: typed non-choice value dropped a pick; repeat of round 1, settled by the agent on the user's note to take its decisions)
- 3 · 95919069 · PASS (re-review of the fold rule; the later shim removal was compile and tests only, at the cycle limit)
### Test gate
- claude-controls, session-fold, claude-code-harness tests (edited with the change); chat-sessions.test.ts (confirmPicks and the reported-value restart row read the controls report) · 569 passed
- Fix cycle: src/session-host, src/main/claude-code, src/main/session-host, src/plugins/chat/main, fake host test · 1247 passed at 96f0c3d6; live drive run fix-check at 96f0c3d6 · 5 of 5
