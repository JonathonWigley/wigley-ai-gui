# 09 — Doc re-read

Status: in progress
Type: Task
Rung: standard · reads four docs against the built code and changes only the lines that are no longer true
Wave: 4 · Depends on: 01 (docs name its contract), 02 (docs name `confirm`), 03 (docs name `readsEverySlot`), 04 (docs list the risky and target sets), 05 (docs list the target rules), 06 (docs name `sendTo` and the frame), 07 (DESIGN.md names the Tag), 08 (docs name the tools)
Plan: [plan.md](plan.md)

Files:
- modify `wigley-ai-gui/AGENTS.md`
- modify `wigley-ai-gui/DESIGN.md`
- modify `wigley-ai-gui/docs/features/agent-commands/design.md`
- modify `wigley-ai-marketplace/plugins/wigley/scripts/forms/README.md`

Consumes:  the built code of 01–08
Produces:  the four docs, true of the built code, with no "planned" marks for this feature

Decisions:
- These docs were written ahead, before the code: commit `fb0ca6b01` and this plan's revision commit. Read each one
  through against the code as built. Fix every line the build made untrue: a name, a pinned text, a set, or a rule a
  task settled another way. Write each fix to `wigley:writing-for-agents`.
- Remove each "planned" or "not built yet" mark this feature added:
  - `AGENTS.md`: the command bullet, the slot bullet and the MCP tool bullet (each `Planned in
    \`plan-agent-commands\`, not built yet`), the plugin tree's `agent-commands/` entry, the forms `confirm` note, and
    the chat `agent-frame.ts` / `sendTo` / `isUnattended` / `senderName` note
  - `DESIGN.md`: the Chat line's "from" Tag
  - the forms README: the tools sentence (`Among them, planned in …`) and the pre-approval sentence (`It also approves
    \`run_command\` (planned in …)`)
  - `design.md`: replace the Status paragraph with `Built.`
- Leave the "Claude Code caches tool schemas" sentence in `AGENTS.md`: it stays true.
- No version bump here (lead ruling 10). The wigley plugin went to `2.15.1` for this README change in `fb0ca6b01`, and
  a series that lands together takes one bump.

GIVEN the built feature WHEN an agent runs `grep -in 'planned\|not built yet'` over the four docs THEN no hit names this feature, and `grep -c 'plan-agent-commands'` prints 0 in each

Tests: none — doc text (`wigley:writing-tests` § What earns neither).

Done when: each doc has been read in full against the code, and the two greps above pass.
Commit:    one commit for the group
