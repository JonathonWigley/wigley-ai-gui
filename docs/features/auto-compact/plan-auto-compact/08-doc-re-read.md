# 08 — Doc re-read

Status: done
Type: Task
Wave: 6 · Depends on: 01, 02, 03, 04, 05, 06, 07
Plan: [plan.md](plan.md)

Files:     modify only the docs below, where a line disagrees with the landed code
Consumes:  the landed code of tasks 01–07
Produces:  each doc written ahead, true to the landed code
Decisions: the code is the source of truth; a doc line that disagrees is rewritten to the code (design.md § Decisions
           and § Rejected stay as the interview settled them, unless the code proves one wrong: then report it)

Read each doc below line by line against the landed code. Fix every stale line. Check every name, signature, label,
setting key, file path and rule the line states.

- `docs/features/auto-compact/design.md` — every section. Check especially: the records' field names, the setting
  key the user writes (`autoCompact.minTokens` or the key task 07 found), the label table against the default
  layouts, the 5 s skip bound against task 02's interrupt path, and the flow against the landed calls.
- `AGENTS.md` § Architecture — the **send gate** bullet. Also add the `auto-compact` plugin wherever AGENTS.md lists
  the plugins or their folders, if it lists them.
- `DESIGN.md` — the Usage bullet (the chip, the pulse, the zero line) and the Chat bullet (the dock's `Compacting…`
  state, the held row label, the divider and its text).
- `docs/features/agent-tower/design.md` § Agent events — the two compaction rows against `AgentEvent`.
- `docs/features/usage/design.md` § The usage plugin — the chip and the fold.
- `docs/features/agent-chat/claude-stream.md` § Compaction — task 01's measured facts against what the decoder now
  reads; and any other line in the doc that names `compacted`.

Also grep the repo docs for `compacted` (the removed event) and fix each stale mention.

Done when: each doc above was read line by line, every stale line is fixed, and the grep for `compacted` finds no
stale mention.
Commit:    one commit for the doc fixes, naming each doc changed; no commit when no line changed (record that in Proof)

## Proof

Commit 14bd0fb5 · proof: Doc diff read; worker read each listed doc against the code; no autoCompact.minTokens exists; the compacted grep finds no stale mention outside the plan folder; DESIGN.md, usage/design.md and claude-stream.md needed no change · concerns: none
