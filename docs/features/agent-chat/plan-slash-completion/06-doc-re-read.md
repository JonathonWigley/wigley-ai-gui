# 06 — Doc re-read

Status: done
Type: Task
Wave: 4 · Depends on: 01, 02, 03, 04, 05
Plan: [plan.md](plan.md)

Files:     modify, where a line is stale or missing: `docs/features/agent-chat/claude-stream.md` · `docs/features/agent-chat/design.md` · `AGENTS.md` · `docs/features/settings/design.md` · `docs/features/docs-browser/design.md` · `docs/features/backlog/design.md` · `docs/features/notes/design.md` · `docs/features/layouts/design.md` · `docs/features/followups.md`
Consumes:  the landed code of 01–05
Produces:  every line the docs state about this work matches the landed code
Decisions: the docs written ahead (commit `c4017923`) came before the code and are hypotheses (`wigley:writing-for-agents` § Doctrine before code) · what the plan changed after them is written here, from the landed code
Checks:    read each doc's lines against the code. `git show c4017923` lists the lines written ahead; later edits may have moved them.
           - `claude-stream.md` § Initialize: "the app's Claude adapter sends it too and reads `commands`" matches `claude-code-harness.ts` and `session-fold.ts`; the section names the version last measured
           - `design.md` § Agent harness seam, Commands: **rewrite**. Today it says names only and that the list waits for the first message. It states the `AgentCommand` fields, `initialize` at start, the merge rule, the failure log and what a re-attach does, matching 02
           - `design.md` Slash completion, Completion rows, App slash commands: `addCompletionRow`'s signature, the newest-first rule, the `completionDescriptions` setting name and default, "a row no draw takes shows the name alone", and the `completionDescription` layout part, matching 03 and 05
           - `design.md` § Plans, Plan D: the summary still fits what landed
           - `AGENTS.md`: the `fzf/` line, "every `/` filter and the slash completion rank with" (filters match without ranking, so reword if the line overstates), the editor line, "(editor, markdown, fuzzy matcher)", matching 01, 03, 04. Add `FuzzyMatcher`'s `fuzzy` page service where page services are listed, if they are listed
           - `settings/design.md` and `docs-browser/design.md` filter lines match 04
           - `backlog/design.md`: the `/` row in its key table says fuzzy on a follow-up's title and tag and on plan and feature rows, substring on the one line
           - `notes/design.md`, if it describes the Target picker: a repo's name outranks its path
           - `layouts/design.md`, if it lists chat's parts: `completionDescription`
           - `followups.md`: the "Picker ranks recent targets higher" item still says what is left; the other lines naming `FuzzyMatcher` and `src/renderer/fzf/` match the names that landed
Done when: each listed line is true of the code or fixed; the fixes are committed in one commit (no commit when nothing changed, and the Proof says so)
Commit:    one commit for the group

## Proof

Commit 0f106a88 · proof: diff read against the landed code; each listed check reported; docs only · concerns: DESIGN.md has no line for the description, left while a peer holds edits there; init.slash_commands holding the same 101 entries is unverified on 2.1.318; design.md still says the row's element holds the drawn name
