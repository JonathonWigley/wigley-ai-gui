# Start session tool — plan

Feature: agent chat · Implements: none · Ticket: none
Target: main · Written: 2026-11-04

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

An agent in any session with the wigley forms relay calls a new MCP tool, `start_session`, and a new chat session starts in the app under the folder and profile it names, with its prompt as the first message. The session's row appears in the side bar without taking focus. Until now only the app's own window could start a chat session.

## Architecture

Chat contributes the tool through `sessions.contributeTools`, as it does `permission_prompt`. The tool's handler validates its arguments, picks the defaults and calls the launch chat already has.

Systems touched:

- `src/plugins/chat/main/`: one new tool module, and one contribution in `start.ts`.
- No relay or marketplace change. The relay serves the tool list the app writes to `tools.json` (`relay.py`, `_tools_list`), and routes every `tools/call` to the app.

## Preconditions

| Claim | Command that checks it | At plan time |
|---|---|---|
| `plan-session-hub` is closed, because that run edits `src/plugins/chat/main/start.ts` on this branch | `test ! -d docs/features/chat-bar/plan-session-hub` | Fails: that run is in progress on `main`. `wigley:make` stops at preflight until it closes |
| The launch request is still folder, profile and message | `grep -n -A4 'export interface LaunchRequest' src/plugins/chat/contract.ts` | Holds |
| Chat contributes a tool from its main start | `grep -n 'sessions.contributeTools(PERMISSION_TOOLS' src/plugins/chat/main/start.ts` | Holds |
| The relay reads its tool list from `tools.json` | `grep -n 'tools.json' ../wigley-ai-marketplace/plugins/wigley/scripts/forms/relay.py` | Holds |

## Docs written ahead

Commit: `cbd80cb0`.

- `docs/features/agent-chat/design.md` § Chat plugin, the bullet "Starting a session from an agent"
- `AGENTS.md`, the `chat/` line of the source tree

`docs/features/followups.md` also gained the signing item in that commit. It describes separate work, so the re-read task does not check it.

## Mandatory Reads

- `AGENTS.md`, § Architecture, where it covers an MCP tool and an ambient service
- `docs/features/agent-chat/design.md`, § Chat plugin, the bullet above
- `src/plugins/sessions/main/title-tool.ts` and `title-tool.test.ts`, the pattern this tool follows

## Design Overview

```
agent in any session
   │ tools/call start_session { prompt, folder?, profile? }
   ▼
relay ─► sessions routes by tool name ─► chat's start-session tool session
                                            │ validate, pick defaults
                                            ▼
                                         chat launch ─► new row, not selected
                                            │              + first message sent
                                            ▼
                        text result naming the session, folder and profile
```

Decisions:

- MCP tool only. No command-line route (round 1).
- No app-side approval or cap. The calling session's permission mode gates the call (round 2).
- `prompt` is required. `folder` and `profile` are optional and default to the calling session's (round 3).
- A session chat does not own has no chat profile, so `profile` falls to chat's first profile, as Notes does.
- `folder` must be an absolute path to an existing folder. The tool never creates one, and takes no `~` or relative path, because a mistyped path must fail rather than start a session somewhere unintended.
- The result is an error result, never a thrown error, for every bad argument and every launch failure, so the calling agent reads the reason.

Out of scope:

- Live reach to sessions already open. On `main` a contribution reaches only sessions that connect after it. The `foundation-sweeps` branch changes that, and changes `contributeTools` to return a `Disposable`. Merging it touches one line of this contribution.
- Model, effort or permission-mode arguments. `chat.launch` does not take them, and no caller needs them yet.
- Sending to or ending the started session from the caller.

## File Structure

Existing files modified:

- `src/plugins/chat/main/start.ts`: contribute the tool.
- `src/plugins/chat/main/start.test.ts`: its `sessions` fake's `contributeTools` records what chat contributes, for the wiring row in 01.

New files:

- `src/plugins/chat/main/start-session-tool.ts`: the definition and handler. It sits apart from `chat-sessions.ts` because it depends only on a small deps record, which is what lets a test drive it alone, as `sessions/main/title-tool.ts` does.
- `src/plugins/chat/main/start-session-tool.test.ts`: the handler's rules in one table.

Boundary rules:

- The tool module imports types from `sessions/contract` and `chat/contract` only, and reaches chat and the file system through its deps.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [The start_session tool](01-start-session-tool.md)

### Wave 2
- [x] [Doc re-read](02-doc-re-read.md) — after 01

### Wave 3
- [x] [Final verification](03-final-verification.md) — after 02

## Run log

Review base: 4de544d7

### Groups
- 01 · 87fd8df5 · diff read: all three Produces present, profileOf hoisted, contribution beside PERMISSION_TOOLS, no start order moved; worker: typecheck and lint clean, 63 tests in the two touched files pass · concerns: third private textResult copy (title-tool.ts:35, chat-sessions.ts:407); a launch throw reaches the caller but no log line unless startNew logs it; check order between prompt, profile and folder is pinned only through stat not called; non-object args other than null have no row
- 02 · none · both written-ahead lines read against 87fd8df5: the design.md bullet and the AGENTS.md chat/ line hold; launch passes select false in chat-sessions.ts; no line changed · concerns: none
- 03 · none · drive run start-session-check with real Claude, spending about 0.59 dollars: agent called the tool through the relay with only a prompt; second row in the same folder under the same profile; first row stayed selected; prompt arrived as the first message; start_session listed in tools.json · concerns: the started session runs the full agent setup, so a one-word prompt cost 0.27 dollars and about 50k of context; before and after selection queries were not timed against the launch; MaxListenersExceededWarning for plugin:message listeners, not checked against main
### Contract changes
### Rulings
- The preflight line requiring plan-session-hub closed is met by isolation, not by that run closing: the user asked for a worktree while the hub run was still open, so the shared start.ts is reconciled at the merge — a merge conflict in start.ts if wrong · lead
- The test gate and the drive run stay in the worktree: worktree-runs.md defers them because they need the Unity editor, which this repo has none of, and AGENTS.md sends drive checks beside a peer's into a worktree — none if wrong · lead
- FileStat is a type import from src/contracts/files, past the boundary rule's two contracts, because the Produces names it; the layer check passes — the deps' stat type needs another source if wrong · group 01 · group 01
- errorText is a run-time import from src/shared/error-text, reading the boundary rule as covering plugin contracts and how chat and files are reached; the layer check passes — a one-line local copy if wrong · group 01 · group 01
- A named profile when chat has no profiles gets the unknown-profile error reading Profiles: none. — wording only if wrong · group 01 · group 01
### Review rounds
- 1 · 752a22b3 · NEEDS FIXES: 10 findings, 3 pre-existing; 2 lead-applied
- 2, re-review of c96ca5ed bc716b0a da9ea5c9 and marketplace cc177ce · da9ea5c9 · NEEDS FIXES: 4 determined, no repeat; profile match traced and holds
### Test gate
- start-session-tool.test.ts: the new handler's rules; start.test.ts: the contribution and the hoisted profileOf export; title-tool.test.ts: the sibling tool whose pattern the module follows · 3 files, 71 tests pass
