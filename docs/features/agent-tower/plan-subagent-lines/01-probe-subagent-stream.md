# 01 — Probe the CLI's subagent stream

Status: not started
Type: Task
Wave: 1 · Depends on: none (precondition: the usage plan `docs/features/usage/plan-usage/` has landed)
Plan: [plan.md](plan.md)

Files:     modify `docs/features/agent-chat/claude-stream.md`. The probe's driver and logs go in the run's scratchpad and are never committed
Consumes:  the installed `claude` CLI (`claude --version` → `2.1.314 (Claude Code)` at plan time). Running it is allowed: it is the user's own installed tool, and these probes run it the way earlier probes did
Produces:  two new sections at the end of `claude-stream.md`, named exactly as 03 cites them: `## Subagents` and `## Compaction`. Usage facts are not probed here: `claude-stream.md` § Usage (written ahead by the usage plan, commit `444f673`) already records `modelUsage.<model>.contextWindow`, `usage.cache_creation` and the usage control requests, and the usage plan's adapter emits `usage`
Decisions: **how it runs**: exactly as `claude-stream.md` § How every probe ran: a `python3` stdlib driver, the same binary path, a fresh scratch project folder holding `notes.txt` with the line `spike`, `CLAUDE_CONFIG_DIR=$HOME/.claude-personal`, the § Launch nested-session variables stripped, base plus cheap flags (`--model haiku --effort low`), and every line logged with seconds since spawn. One process per probe below unless it says otherwise. Close stdin after the last turn's `result` (plan.md Decided: the CLI probe opens the plan)
           **probes** (stdin as `U(<text>)`):
           1. *spawn*: `U(Use the Agent tool to start one subagent of type Explore with the description "read notes" that reads the file notes.txt with the Read tool and reports its first line. Then reply with the single word done.)` If the model answers without spawning, re-run once with `general-purpose` in place of `Explore`, and record which ran
           2. *default type*: `U(Use the Agent tool, giving no subagent type, with the description "read notes", to read notes.txt and report its first line. Then reply with the single word done.)` This records what `input` holds when no type is named
           3. *failure*: `U(Use the Agent tool with subagent type no-such-agent and description "fail" to read notes.txt. Then reply with the single word done.)` This records the Agent call's error `tool_result`
           4. *background*: always run — the user's sessions launch subagents in the background (`run_in_background: true` on the Agent call) more often than not. `U(Use the Agent tool with run_in_background true, description "read notes", to read notes.txt and report its first line. Wait for it to finish, then reply with the single word done.)` This records when the Agent call's `tool_result` arrives relative to the subagent's own lines, and the event that reports the subagent's own end (a `system` subtype such as `task_notification`, a `<task-notification>` user message, or other), with its id fields and how they tie back to the Agent call's `tool_use` id. If the CLI refuses the option, record that
           5. *compaction*: in the probe 1 process after its result, `U(/compact)`. Then `U(Reply with the single word ok.)`, to see the next message's usage after the compaction
           6. *interrupt*: a foreground subagent that runs long enough to interrupt (for example `U(Use the Agent tool with description "read notes" to read notes.txt and report its first line, then reply with the single word done.)`), then the interrupt control request mid-run exactly as `claude-stream.md` § Interrupt sends it, before the Agent call's `tool_result`. This records whether the Agent call gets a `tool_result` at all, and every subagent line after the interrupt
           **what `## Subagents` records**, each with a trimmed real excerpt in the doc's style:
           - the Agent call's `tool_use` block in its `assistant` event: the tool `name` on 2.1.314, and every `input` key with its value (`subagent_type`, `description`, `prompt`, and any other). § Init lists the tool as `Task` on 2.1.304; say which name init's `tools` lists now and which name the `tool_use` carries
           - each subagent line's top-level `parent_tool_use_id`: on `stream_event` (or "no stream events for subagents" if none appear), `assistant`, `user` (tool results) and `system` lines. Say whether it always equals the Agent call's `tool_use` id
           - whether a subagent's tool calls are `tool_use` blocks in `assistant` events carrying that `parent_tool_use_id`, and their results `user` events carrying it
           - the Agent call's `tool_result` on success (content shape, top-level `tool_use_result` keys) and on failure (`is_error`, text), and when it arrives relative to the subagent's last line
           - any `tool_progress` line for the Agent call: its `tool_use_id` and `parent_tool_use_id` (§ Other events says a heartbeat's parent id is the pending call's id, not a subagent's)
           - probe 2's `input` with no type named (key absent, or a default value)
           - probe 4's timing, and the background subagent's end event with an excerpt (or the CLI's refusal)
           - probe 6: any `tool_result` for the Agent call after the interrupt (with `is_error` and text), any subagent lines after it, and the turn's `result`, with an excerpt
           - any new event type or system subtype the subagent lines bring
           - whether a subagent's `assistant` events carry `message.usage`, with one excerpt. The usage plan's `usage` event is the main agent's context, so its reader must skip subagent lines if they do
           **what `## Compaction` records**: the `system/compact_boundary` line (expected) with its full `compact_metadata` (`trigger`, `pre_tokens`, and whether any after-size key such as `post_tokens` exists). Also every other line `/compact` prints in order (`status`, synthetic `assistant`, `user` replay, `result` with its `local_command`), and the next message's `usage` against `pre_tokens`
           **housekeeping in the doc**: add a line under the doc's first line: `§ Subagents and § Compaction measured on 2.1.314, <date>`. When `compact_boundary` or another listed event is now seen, move it out of § Other events' "Expected but not observed" line. Leave every earlier measurement as written
GIVEN the probes above WHEN they run THEN `claude-stream.md` holds `## Subagents` and `## Compaction` with real excerpts for every bullet above, or a line saying what was not observed
Tests:     none: a measurement doc. 03's decoder tests are built from these excerpts
Done when: the two sections are in `claude-stream.md`, each claim backed by an excerpt or an explicit "not observed", and committed. If the CLI refuses to spawn a subagent in every attempt, stop and report: 03 cannot pin its mapping without the measured shapes
Commit:    one commit for the group

## Proof
