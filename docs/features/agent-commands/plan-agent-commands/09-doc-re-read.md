# 09 — Doc re-read

Status: not started
Type: Task
Rung: standard · reads four docs against the built code and changes only the lines that are no longer true
Wave: 4 · Depends on: 01 (docs name its contract), 02 (docs name `confirm`), 03 (docs name `readsEverySlot`), 04 (docs list the risky set), 05 (docs list the target rules), 06 (docs name `sendTo` and the frame), 07 (DESIGN.md names the Tag), 08 (docs name the tools)
Plan: [plan.md](plan.md)

Files:
- modify `wigley-ai-gui/AGENTS.md`
- modify `wigley-ai-gui/DESIGN.md`
- modify `wigley-ai-gui/docs/features/agent-commands/design.md`
- modify `wigley-ai-marketplace/plugins/wigley/scripts/forms/README.md`

Consumes:  the built code of 01–08
Produces:  the four docs, true of the built code, with no "planned" marks for this feature

Decisions:
- These docs were written ahead in commit `fb0ca6b01`, before the code. Read each one through, against the code as
  built, and fix every line the build made untrue: a name, a pinned text, a rule a task settled another way.
- Remove each "planned" or "not built yet" mark this feature added: in `AGENTS.md` (the command, slot and MCP tool
  bullets, the plugin tree's `agent-commands/` entry, the forms `confirm` note, the chat `agent-frame.ts` / `sendTo` /
  `isUnattended` note), in `DESIGN.md` (the Chat line's "from" Tag) and in the forms README (the three tools). Set
  `design.md`'s Status to built.
- Leave the "Claude Code caches tool schemas" sentence in `AGENTS.md`: it stays true.
- A change to the forms README is a change to the wigley plugin: bump the patch version in
  `wigley-ai-marketplace/plugins/wigley/.claude-plugin/plugin.json` and `.codex-plugin/plugin.json` together
  (the marketplace's `AGENTS.md` version rule) — once for this task, from the version the tree holds then.
- Write each fix to `wigley:writing-for-agents`.

GIVEN the built feature WHEN an agent greps the four docs for `planned` and `not built yet` THEN no hit names this feature

Tests: none — doc text (`wigley:writing-tests` § What earns neither).

Done when: each doc has been read in full against the code; the grep above finds no hit for this feature; the two
plugin manifests carry the same new version when the README changed.
Commit:    one commit for the group
