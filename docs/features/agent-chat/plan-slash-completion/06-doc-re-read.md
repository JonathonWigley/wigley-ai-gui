# 06 — Doc re-read

Status: not started
Type: Task
Wave: 4 · Depends on: 01, 02, 03, 04, 05
Plan: [plan.md](plan.md)

Files:     modify, where a line is stale: `docs/features/agent-chat/claude-stream.md` · `docs/features/agent-chat/design.md` · `AGENTS.md` · `docs/features/settings/design.md` · `docs/features/docs-browser/design.md` · `docs/features/followups.md`
Consumes:  the landed code of 01–05
Produces:  every line the docs written ahead (commit `c401792`) state about this work matches the landed code
Decisions: the docs were written before the code and are hypotheses (`wigley:writing-for-agents` § Doctrine before code)
Checks:    read each doc's lines from `git show c401792 --stat` / `git show c401792` line by line against the code:
           - `claude-stream.md` § Initialize: "the app's Claude adapter sends it too and reads `commands`" — matches `claude-code-harness.ts`
           - `design.md` § Agent harness seam, Commands: the `AgentCommand` fields, the merge rule, the failure log — match 02
           - `design.md` Slash completion, Completion rows, App slash commands: `addCompletionRow`'s signature, newest-first rule, the `completionDescriptions` setting name and default, "a row no draw takes shows the name alone" — match 03 and 05
           - `AGENTS.md`: the `fzf/` line, "every `/` filter and the slash completion rank with" (Settings and Docs filters match without ranking — reword if that line now overstates), the editor line, "(editor, markdown, fuzzy matcher)" — match 01, 03, 04
           - `settings/design.md` and `docs-browser/design.md` filter lines — match 04
           - `followups.md` lines naming `FuzzyMatcher` and `src/renderer/fzf/` — the names landed as written
Done when: each listed line is true of the code or fixed; the fixes are committed in one commit (no commit when nothing changed, and the Proof says so)
Commit:    one commit for the group

## Proof

