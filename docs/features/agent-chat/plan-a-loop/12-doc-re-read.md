# 12 — Doc re-read

Status: done
Type: Task
Wave: 7 · Depends on: 11
Plan: [plan.md](plan.md)

Files:     modify `AGENTS.md` · modify `docs/features/agent-chat/design.md` · modify `docs/features/followups.md` (each only where a line is stale)
Consumes:  every Produces of tasks 01–11, as landed
Produces:  docs that state the landed code, line by line
Decisions: the docs were written ahead of the code (commit `376f1cc`), so each is a hypothesis until this check
           (`wigley:writing-for-agents` § Doctrine before code) · a line describing plan B's work (resume, archive,
           history, slash completion) stays, marked in `design.md` as plan B, since plan B lands it
GIVEN the docs written ahead and the landed code WHEN each line is read against the code it describes THEN every
      stale line is fixed and no line states a name, path, key, setting or behaviour the code lacks
Tests:     none — a doc check; the proof is the diff and the list of lines checked
Approach:  read each doc whole; for every line naming code — a path, a type, a member, a key, a setting, a log line,
           a behaviour — open the code and confirm it. Lines to check at least:
           `AGENTS.md`: the intro's chat sentence; the layout tree's `src/shared/` (fake agent harness, `layouts/`,
           `page/` layout loader), `src/main/claude-code/`, `src/plugins/chat/` lines and the removed `acp/` and
           `mock-agent/` lines; the owned-session sentence after the relay paragraph; **A session tab** (Chat tab,
           `takeOver`); **Debug and testing keys** (`Space z c …`); **An agent harness**; **A session control**
           (`Space c m` / `e` / `o`, `Space c c`); **A layout**; the self-test sentence in **Running and testing**
           (one script per plugin, in start order, chat's over the fake harness); **Dev quirks**.
           `docs/features/agent-chat/design.md`: Vocabulary, Flow (the `claude` arguments against task 06's argument
           list), Agent harness seam (how `mode`, `effort`, `model` change, against task 06 and
           `claude-stream.md`), Sessions and tabs, Chat plugin (keys against chat's manifest; picker keys; the
           start prompt steps), Layouts, Self-test.
           `docs/features/followups.md`: the five agent-chat lines still describe work not done.
           Add to `AGENTS.md` any fact the run found that an agent working here needs and the code cannot show (a
           Claude CLI behaviour from `claude-stream.md` the adapter relies on), at the volume of the lines beside it.
Done when: every listed line checked against the landed code, every stale one fixed, and the fixes committed; the
           commit message lists the lines changed, or says none were stale
Commit:    one commit for the group

## Proof

c02b20e · diff read: design.md fixes the Flow start-prompt line, the controls, interrupt and cost bullets, the Chat tab status line and the start prompt bullet; AGENTS.md gains the adapter's CLI readings and the corrected `Space c c` line; followups.md's five agent-chat lines were checked and stand. Concern: an empty, untracked `src/main/forms/` folder from Oct 18 sits in the tree; it predates the run and was left alone.
