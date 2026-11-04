# Agent cards (design A) — plan

Feature: chat-bar · Implements: none · Ticket: none
Target: main · Written: 2026-11-03

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

The agent strip above the Chat composer draws each box as design A: a running dot, the agent's name, a kind tag
(Subagent, Background agent, Shell), a ticking runtime, the description, and for a subagent its `model · effort`, the
latest 3 tool calls with the older two fading, a context bar with `84k/200k` (warning colour at 80% or more) and its
estimated cost. Every box leaves the strip the moment its subagent or task ends, done or failed; nothing is closed by
hand.

## Architecture

```
Claude stream ─▶ stream-decoder (claude-code adapter)
                   agentReplied { …, contextTokens, contextWindow }   ← 01
                   agentLaunched { agentId }                          ← 01
                      │ chat.agentEvent
                      ▼
                 agents roster fold (roster.ts)                       ← 02
                   RosterAgent { isBackground, contextTokens, contextWindow }, no outcome
                   RosterTask  { ownerName }, no outcome
                   any end ─▶ item leaves; sessionEnded ─▶ empty
                      │ rosterChanged
                      ▼
                 agent-strip page ─▶ layout parts agentBox / taskBox  ← 03
                   both ticked once a second (elapsedMs)
```

Systems touched: `src/contracts/agent.ts`, the Claude adapter (`src/main/claude-code/`), the fake harness
(`src/shared/fake-agent-harness.ts`), chat's preview events, the `agents` plugin, the `agent-lines` plugin's running
filter, the `agent-strip` plugin and its layout contract.

## Preconditions

- `git -C /Users/jonathonwigley/Documents/ai-dev/wigley-ai-gui log --oneline -1 -- docs/features/chat-bar/design.md`
  shows `577fd390` (docs written ahead) or a later commit.
- `grep -n "parent_tool_use_id" src/main/claude-code/stream-decoder.ts` finds `reportSubagentReply`, which reads each
  subagent reply's `message.usage` (verified 2026-11-03).
- `grep -n "isAsync" src/main/claude-code/stream-decoder.ts` finds the launch-receipt check in `finishAgentOrTool`
  (verified 2026-11-03).
- `grep -n "function contextWindowOf" src/main/claude-code/session-usage.ts` finds the reader of a result's
  `modelUsage[model].contextWindow` (verified 2026-11-03).

## Docs written ahead

Commit `577fd390`: `docs/features/chat-bar/design.md` (§ The agent strip, § Decisions) and
`docs/features/agent-tower/design.md` (§ Vocabulary Roster, § Agent events table, § The agents plugin).

## Mandatory Reads

- `AGENTS.md` (repo root) — Architecture, Running and testing
- `DESIGN.md` — before task 03's layout CSS
- `docs/features/chat-bar/design.md` § The agent strip, § Decisions
- `docs/features/agent-tower/design.md` § Agent events, § The agents plugin

## Design Overview

**Decisions (from the interview, 2026-11-03):**

- Build on the existing agent strip; no new view.
- Every box leaves when its process ends, done or failed; `sessionEnded` (the Claude process exits or crashes) empties
  the roster. A soft interrupt reaches the roster as the `agentFinished`/`taskFinished` events the adapter already
  sends, so those boxes leave too.
  No ✕, close key or Clear control. `userMessage` no longer changes the roster.
- Tags: Subagent, Background agent, Shell. A subagent is Background agent once its launch receipt (`isAsync`) arrives.
  A task is always Shell.
- Runtime on every box, ticking once a second.
- Header: name + tag + runtime; description on the next line. A task's name is its owner's: `main`, else the owning
  subagent's name stored on the task when it starts, so it survives that subagent leaving; `subagent` only for a task
  whose owner was never listed.
- No user layout overrides `agent-strip` today (`~/.config/wigley-ai-gui/layouts/agent-strip/` holds only the
  generated `layout.d.ts`, checked 2026-11-03), so the changed box inputs break nothing outside the repo.
- Subagent: `model · effort` dim line; 3 latest tool lines (opacity 1 newest, 0.7, 0.4; a failed call keeps the error
  colour); context bar + `84k/200k` (warning colour at ≥ 80%; `84k` alone while the window is null); cost `$0.42`
  (left out while null).
- Task: command as one mono line (`no command` when null); no context, no cost.
- Context tokens = latest reply's `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`.
  Window learned from each `result`'s `modelUsage`; a newly learned window is sent at once to every running subagent
  on that model.
- Enter still opens a subagent box to list every tool call (unchanged).
- The layout gets values, not preformatted strings: the label words, the 80% threshold and number formats live in the
  user-editable `default` layout.

**Out of scope:** the activity dock, the workflow strip, the status line, `agent-lines`' look.

## File Structure

Modified:

- `src/contracts/agent.ts` — `agentReplied` fields, new `agentLaunched` (01)
- `src/main/claude-code/stream-decoder.ts`, `stream-decoder.test.ts` (01)
- `src/shared/fake-agent-harness.ts`, `fake-agent-harness.test.ts` (01)
- `src/plugins/chat/main/preview/preview-agent-events.ts`, `chat-preview.test.ts` (01)
- `src/plugins/agents/contract.ts`, `roster.ts`, `roster.test.ts`, `main/preview.ts`, `main/preview.test.ts`,
  `main/start.ts`, `main/start.test.ts`, `page/rosters.test.ts` (02)
- `src/plugins/agent-lines/page/running-work.ts`, `running-work.test.ts`, `working-lines.test.ts`,
  `main/selftest-script.ts` (02)
- `src/plugins/agent-strip/layouts/layout.d.ts`, `layouts/default/layout.js`, `layout.css`, `layout.test.ts`,
  `page/strip-boxes.ts`, `strip-boxes.test.ts`, `page/agent-strip.ts`, `agent-strip.test.ts`,
  `main/selftest-script.ts` (03)

No new files. Shared names across tasks:

- `AgentEvent` `agentReplied`: `{ type; at; agentId; model: string; spendUsd: number | null; contextTokens: number | null; contextWindow: number | null }`
- `AgentEvent` `agentLaunched`: `{ type: 'agentLaunched'; at: number; agentId: string }`
- `RosterAgent`: today's fields minus `outcome`, plus `isBackground: boolean; contextTokens: number | null; contextWindow: number | null`
- `RosterTask`: today's fields minus `outcome`, plus `ownerName: string`
- `RosterTool` and `RosterOutcome` unchanged (a tool line still shows done/failed)

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Agent events carry context and background launch](01-agent-events.md)

### Wave 2
- [x] [Roster: running items only, kind, context, owner name](02-roster.md) — after 01

### Wave 3
- [x] [Strip draws design A](03-strip-cards.md) — after 02

### Wave 4
- [x] [Doc re-read](04-doc-re-read.md) — after 03

### Wave 5
- [ ] [Final verification](05-final-verification.md) — after 04

## Run log
Review base: 693cb8d04eb48c87e6cba0406a0e2d850f90db54
### Groups
- 01 · f678086a · diff read: both Produces members present in src/contracts/agent.ts; typecheck and lint pass; worker ran the task's vitest paths plus src/plugins/agents (616 tests pass) · concerns: a foreground subagent of the main agent is failed before a result's re-emission, so it holds a window only from an earlier result; subagent contextTokens leaves out output_tokens while the main agent's usage counts them; launched agents re-emit in receipt order; a late reply after an agent's end re-creates an unread store entry
- 02 · ef990e82 · diff read: RosterAgent and RosterTask shapes present in contract.ts; lint passes; worker ran vitest on agents and agent-lines (77 tests pass); typecheck has 10 errors, all agent-strip, proved at 03 as the task allows · concerns: a duplicate agentSpawned or taskStarted for an ended id lists it again, for failed items too (no adapter code read to rule it out); agent-strip selftest prose left for 03; agent-tower design line 108 left for 04
- 03 · 55242ea1 · diff read: AgentKind, AgentBoxInput, TaskBoxInput and AgentBoxPart present in layout.d.ts; typecheck (clears 02's errors) and lint pass; worker ran vitest on agent-strip (73 pass) and the agent-strip self-test (passes) · concerns: closed box clips by about a border at 900x700, and agent-strip.css's 80% composer cap comment is slightly untrue there; mono runtime versus DESIGN.md's mono rule; 999,500-999,999 tokens read 1000k; contextWindow 0 gives a NaN percent; spend under half a cent shows $0.00; the tick is seen only in task 05's capture
- 04 · 2c273285 · diff read: two stale design lines fixed; worker reports each grep term run, remaining hits true or about other surfaces; lint passes · concerns: worker did not re-verify chat-bar's keys and scrolling lines against page code beyond the log lines; agent-strip.css's 80% composer cap comment left for the review
### Rulings
- Worktree run on branch agent-cards, from the local main tip; the test gate, self-test and drive checks stay in the worktree — this repo has no Unity editor, and AGENTS.md puts drive runs beside a peer's in a worktree, which has its own .vite — merging the branch back stays the user's call · lead
- User's word for this run: every review recommendation is taken, so no triage round is sent and each finding takes its recommended pick, reported in the wrap-up — the user said so mid-run — a pick the user would have changed lands without a look until the wrap-up · lead
- A [...] key in a result with no plain key beside it deletes the plain key's learned window: a map that only grows cannot pass the 200000-then-[1m] case, and replacing the map per result would lose every window on an empty modelUsage — a process alternating plain and suffixed keys sends the window back and forth · group 01 · group 01
- A result naming both a plain and a [...] key keeps the plain window, per exact-first: if modelUsage is cumulative, a model moved to [1m] keeps showing the old window; task 05's live check can settle it · group 01 · group 01
- Several [...] keys for one model: the first learned wins; the plan names no rule — the card shows the other suffix's window if wrong · group 01 · group 01
- start.test.ts's message row is a cleared host's userMessage sending only [runningA]: the first row already proves a same-host one sends nothing; the fold ignores userMessage, so restoring the fan-out would not turn it red · group 02 · group 02
- ownerName is written once at taskStarted: a task starting before its owner's agentSpawned keeps subagent for good · group 02 · group 02
- Each selection logs box <i> of <n> in <name> shows: <textContent> so the self-test can check tag and runtime: every h/l/j writes tool summaries to the page log; removal is one log line, two alsoExpect rows and one assertion · group 03 · group 03
- DESIGN.md's agent strip paragraph rewritten though outside the task's Files, because the edit outdated it · group 03 · group 03
- Context bar track border-default, height space-1, fill status-success, matching ui-meter · group 03 · group 03
### Test gate
- Vitest picks from the range's diff: stream-decoder.test, fake-agent-harness.test, chat-preview.test (edited, and they assert the new events); src/plugins/agents, src/plugins/agent-lines, src/plugins/agent-strip (edited, and they assert the roster and box shapes) · 15 files, 351 tests pass, no type errors

