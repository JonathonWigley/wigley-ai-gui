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
- [ ] [The start_session tool](01-start-session-tool.md)

### Wave 2
- [ ] [Doc re-read](02-doc-re-read.md) — after 01

### Wave 3
- [ ] [Final verification](03-final-verification.md) — after 02

## Run log

Review base: <sha, written by wigley:make at preflight>

### Groups
### Contract changes
### Rulings
### Review rounds
### Test gate
