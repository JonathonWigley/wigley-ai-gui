# Headless after start — plan

Feature: agent chat · Implements: none · Ticket: none
Target: main (wigley-ai-gui), main (wigley-agents) · Written: 2026-11-09

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

A session turns headless only after it starts: from the Headless chip it already has, or from its
agent calling a new `set_headless` tool when the user's words hand it the rest of the run. The start
prompt loses its New headless session line, and a session step left holding only New session is
skipped.

## Architecture

- **chat page** — the start prompt (`start-prompt.ts`) and its session-step lines
  (`resume-items.ts`): the headless line and the `headless` field of a new-session line go; a step
  whose lines are exactly the one New session line starts the session at once.
- **chat contract and main** — `StartRequest.headless` goes, since the prompt was its only caller;
  `start` opens every row non-headless. Resume (`ResumeRequest.headless`) and `launch`
  (`LaunchRequest.headless`, which `start_session` and workflow-large's make-in-new-session copy)
  are unchanged.
- **chat main tool** — a new `set_headless` MCP tool, contributed through sessions'
  `contributeTools` with `{ mainAgentOnly: true }` beside `start_session`, calling chat's own
  `setHeadless`. The chip, row tag, forms auto-answer and workflow headless lines all read the flag
  live, so nothing else changes.
- **wigley-agents** — `workflows.md` § Headless tells the agent when to call the tool. It sits on
  branch `headless-tool` in worktree `../.worktrees/wigley-agents-headless-tool`, merged only after
  the app code lands (task 03), since it names a tool the app must already offer.

## Preconditions

- gui worktree `../.worktrees/wigley-ai-gui-headless-tool` on branch `headless-tool`, from main
  `10ee4da7` — `git -C wigley-ai-gui worktree list`
- wigley-agents worktree `../.worktrees/wigley-agents-headless-tool` on branch `headless-tool`
  holding commit `6f50ce7` — `git -C wigley-agents log --oneline -1 headless-tool`
- `StartRequest.headless` is read only at `chat-sessions.ts` `start` (about line 3830); the other
  `request.headless` reads (about 3023, 3552, 3581) are launch and resume requests — `grep -n
  "request.headless\|StartRequest" -r src --include='*.ts'` (measured at plan time, re-verify)
- No tool named `set_headless` exists — `grep -rn set_headless src` returns nothing

## Docs written ahead

- gui `ae89ef75`: `docs/features/agent-chat/design.md` (§ Start prompt, § Resume and archive, new
  § Headless from an agent), `AGENTS.md` (chat's tool list)
- wigley-agents `6f50ce7` (unmerged branch `headless-tool`): `workflows.md` § Headless

## Mandatory Reads

- `AGENTS.md` (gui) — § Architecture: An MCP tool, A plugin talks, Running and testing (filtered
  self-test only)
- `docs/features/agent-chat/design.md` § Start prompt, § Resume and archive, § Headless from an agent
- `~/wigley-agents/AGENTS.md`, `~/wigley-agents/WigleyRepos.md` § Landing

## Design Overview

```
Space b n / Ctrl+n ─► project ─► branch ─► profile ─► sign-in
                                                      │
                     session step lines == [New session] only? ── yes ─► start (not headless)
                                                      │ no
                                                      ▼
                                      New session · saved · resume-section rows
                                      (a headless resume-section row resumes headless)

agent ── set_headless {headless} ─► chat main tool ─► chat.setHeadless(id, flag)
                                         │                  └─► chat.session slot ─► chip, row tag
                                         │                                        ─► forms auto-answer
                                         └─ result: HEADLESS_NOTE | HEADLESS_OFF_NOTE
                                            (error for a session chat does not own)
```

Decisions (round 1, all as recommended, plus Decided notices):

- the tool turns headless on and off (`headless: boolean`)
- only words covering the rest of the run turn it on; a one-round "go with your recs" does not
  (`workflows.md`)
- a one-line session step is skipped — `Ctrl+n` always, and `Space b n` when the target has no saved
  sessions or the listing failed (Decided: same rule, every caller)
- chat contributes the tool, main-agent only; a subagent's call changes nothing (chat's guard)
- a call from a session chat does not own returns an error
- a repeat call with the flag already set still returns the state's line and changes nothing

Out of scope: the follow-up "Headless off note: chat sends it, not the workflow tools"
(`docs/features/followups.md`). After an agent turns headless off, the next workflow tool result
also carries `HEADLESS_OFF_NOTE` once; that repeat is harmless and left as is.

## File Structure

Modified:
- `src/plugins/chat/page/resume-items.ts`, `resume-items.test.ts`
- `src/plugins/chat/page/start-prompt.ts`, `start-prompt.test.ts`
- `src/plugins/chat/contract.ts` (`StartRequest`)
- `src/plugins/chat/main/chat-sessions.ts` (`start`), `chat-sessions.test.ts` where a test starts headless
- `src/plugins/chat/main/selftest-script.ts` (ARCHIVE_STEPS)
- `src/plugins/chat/main/start.ts` (contribution), `start.test.ts`

New:
- `src/plugins/chat/main/set-headless-tool.ts` — the tool's definition and tool session, beside
  `start-session-tool.ts`, which is the pattern
- `src/plugins/chat/main/set-headless-tool.test.ts`

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Start prompt drops the headless line](01-start-prompt.md)
- [x] [The set_headless tool](02-set-headless-tool.md)

### Wave 2
- [x] [Doc re-read and the workflows.md merge](03-doc-re-read.md) — after 01, 02

### Wave 3
- [x] [Final verification](04-final-verification.md) — after 03

## Run log

Review base: f8e35fea

### Groups
- 02 · 46bd354e · diff read: all three Produces present in set-headless-tool.ts; wiring mainAgentOnly in start.ts; set-headless-tool + start tests 79 pass, no type errors · concerns: lint fails only on oxfmt in chat-sessions.test.ts (group 01's file, in progress)
- 01 · f2d06df9 + fix 8 picker-row · diff read: both Produces present (resume-items.ts new line, contract.ts StartRequest); tsc clean after fixture fix; lint clean; resume-items/start-prompt/chat-sessions/picker-row tests pass · concerns: tsc caught a picker-row.test.ts fixture still carrying headless, fixed by re-dispatch; selftest not yet run (gate)
- 03 · ddf11e8c · diff read: one stale design.md line fixed; AGENTS.md, workflows.md (6f50ce7) and marketplace README match the code, no edit · concerns: none
- 04 · 1d41e31d · lint, tsc, picked tests, selftest --plugin chat all passed; drive run headless-check: Ctrl+n starts with no Session picker, Space b n lists New session + two saved rows, screenshots read · concerns: none
### Contract changes
### Rulings
- owns reads chat.sessions().some(sessionId) rather than profileOf !== null — independent of a row having a profile — none, the reads agree today · group 02 · group 02
- four start-prompt 'new lines alone' tests folded into one table sessionStep_NoRowsToList_StartsAtOnce, plus an archived-only table with a second row for archiving the last live row — they share one rule — one extra row to delete · group 01 · group 01
### Review rounds
### Test gate
- Medium — UI wiring in the start prompt plus a new MCP tool across chat's contribution and its flag · picked: resume-items, start-prompt, picker-row, chat-sessions (own the changed rules), set-headless-tool + chat start (the tool and its wiring); tsc + lint; selftest --plugin chat (archive step changed); drive run Ctrl+n starts at once and Space b n shows one New session line · skipped: whole self-test (user's ask only), real-Claude set_headless call (fake harness cannot call MCP tools) · all passed
