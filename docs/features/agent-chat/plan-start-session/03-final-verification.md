# 03 — Final verification

Status: in progress
Type: Task
Wave: 3 · Depends on: 02
Plan: [plan.md](plan.md)

Files:     none

Decisions:

- One drive run with `start --harness claude`, following `.agents/skills/drive/SKILL.md`. It spends tokens, and is justified because a fixture cannot prove a real agent sees and calls the tool. Name that in the report.

Live checks:

- **Expected path.** In a session the drive run started, tell the agent to call `start_session` with only a prompt. A second row appears in the same folder under the same profile, the first row stays selected, and the new session has received the prompt.
- **Low-confidence path, wiring no test sees.** The tool appears in the run's `tools.json` under `<run home>/.agents/<instance id>`, and the real agent can see it through the relay.

The argument rules are pinned by the tests in 01 and take no live check.

Done when: both checks are reported with what the run showed

Commit:    none, unless a check finds a fix

## Proof

