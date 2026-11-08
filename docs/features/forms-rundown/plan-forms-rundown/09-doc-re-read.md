# 09 — Doc re-read

Status: in progress
Type: Task
Wave: 6 · Depends on: 07, 08
Plan: [plan.md](plan.md)

Each doc written ahead is a hypothesis until this task re-reads it against the landed code
(`wigley:writing-for-agents` § Doctrine before code). Read each doc below line by line, whole, against the code that
tasks 01–07 landed. Fix every stale line in place, in that doc's own worktree. Commit the fixes in each repo that
changed, one commit per repo.

Worktrees (branch `forms-rundown`):

- agents `AG` = `/Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-agents-forms-rundown`
- marketplace `MK` = `/Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-marketplace-forms-rundown`
- gui `G` = `/Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-gui-forms-rundown`, `F` = `G/src/plugins/forms`

Files:     check, and modify only where stale:
           `AG/forms.md` · `AG/AGENTS.md` (§ Communication) ·
           `MK/plugins/wigley/skills/feature/SKILL.md` (§ Question format and the interview text that points at it) ·
           `MK/plugins/wigley/skills/review/triage.md` · `MK/plugins/wigley/scripts/forms/README.md` ·
           `G/AGENTS.md` (the forms layout bullet, its sentence "defines every card and the rail and review panes" gaining
           the notices pane, and the item kind bullet) · `G/docs/features/layouts/design.md` (the forms row) ·
           `G/docs/keymap.md` (the forms binds) · `G/docs/features/plugin-framework/design.md` (about line 97: "the fold
           keys (`za`, `zM`, `zR`) … are removed"; reword so it no longer says `za` is unbound in forms, since 04 binds
           it to `forms.toggleNotice`)
Consumes:  the landed code of 01–07; the version 1.20.2 ← 08
Produces:  every doc above true to the landed code; the fix commits
Decisions: docs written ahead, re-read in their own task (plan § Docs written ahead) · stale wording is fixed, not
           reported only (`~/wigley-agents/AGENTS.md` § Workflow)

## Claims to check, and the code that settles each

| Claim the docs make | Docs that make it | Code to read |
|---|---|---|
| A question carries a required `summary` field that replaces `question`, and the card draws it as its headline, first, as inline markdown | `AG/forms.md` § Questions; `MK/.../forms/README.md` (question fields, markdown rules); `MK/.../feature/SKILL.md` | `F/contract.ts` `Question`; `F/main/kinds/question/question-format.ts` (`QUESTION_FIELDS`, schema description); `F/layouts/default/layout.js` question card (`kit.inlineMarkdown`) |
| The card order is summary, then context, then the choices with the recommended one's rationale under it; `title` shows only in the rail | `AG/forms.md` § Questions; `MK/.../forms/README.md` | `F/layouts/default/layout.js` question card; `F/page/layout/card-kit.ts` `choiceList` |
| Question cards draw no section labels: no Question, Context, Why recommended or Your answer; finding cards keep theirs | `AG/forms.md` § Questions; `MK/.../forms/README.md` | `F/layouts/default/layout.js`; `F/page/kinds/card-parts.ts` `buildChoiceReason`; `F/page/layout/card-kit.ts` (`appendAnswerArea`, the finding's `'Why'`) |
| Notices draw last, all on one page after every finding and question; each is one line, badge and title, that opens to its context and one comment box | `AG/forms.md` § Notices; `MK/.../forms/README.md`; `MK/.../review/triage.md` (the no-form fallback lists notices last); `G/AGENTS.md` forms layout bullet | `F/page/form-state.ts` `railItems`; `F/page/layout/layout-panes.ts` (or the module 05 names) notices pane; `F/layouts/default/layout.js` `notices` and `cards.notice` |
| A forms layout has a `notices` pane beside `head`, `rail` and `review`, picked by the pane chain (round → setting → default) | `G/AGENTS.md` forms layout bullet; `G/docs/features/layouts/design.md` forms row; `MK/.../forms/README.md` (layout chain) | `F/layouts/layout.d.ts` `Layout.notices`, `CompleteLayout`; `F/page/layout/layout-resolver.ts` (`LayoutPart`, `PANES`); `F/page/layout/read-layout.ts` `FUNCTION_PARTS` |
| The kit holds a notice line part | `G/AGENTS.md` forms layout bullet ("notice line") | `F/layouts/layout.d.ts` `NoticesKit.line` |
| A saved round whose question holds `question` and no `summary` reads `question` as the summary | `MK/.../forms/README.md` | `F/main/kinds/question/question-format.ts` parse |
| Evidence goes last in a `:::details Sources` block inside `context` | `AG/forms.md` § Questions; the triage and feature skill where they point at it | `src/renderer/markdown-it/markdown-it-renderer.ts` (`:::details` renders a native `<details class="md-details">`); the label-free context (`F/layouts/default/layout.js` `kit.markdown`) |
| The `ask_round` description points at `~/wigley-agents/forms.md`, and the `summary` and `context` descriptions keep a short backstop | `AG/forms.md` (its opening); `AG/AGENTS.md` § Communication | `F/main/tool-definitions.ts` `ASK_ROUND_DESCRIPTION`; `F/main/kinds/question/question-format.ts` field descriptions |
| Every section a pointer names exists: `forms.md` § Every item, § Questions, § Findings, § Notices, § Written fallback | `AG/AGENTS.md`; `MK/.../feature/SKILL.md`; `MK/.../review/triage.md` | the headings of `AG/forms.md` (checked at plan time: all five exist) |

Two lines outside the docs written ahead may go stale through task 04. Check them in the same pass:

- `G/AGENTS.md`, the item kind bullet (line 615–616 at plan time): `` `RAIL_ORDER` in `form-state.ts` is added to by
  hand ``. When task 04 removed `RAIL_ORDER`, rewrite the sentence to name what now sets the stop order (`railItems`),
  or drop the clause.
- `G/docs/keymap.md`, the forms binds: it must list `j`/`k` as `forms.nextLine`/`forms.prevLine`, `za` as
  `forms.toggleNotice` and `o` beside `a` for `forms.editNotes`. Task 04 owns it; fix it here only when 04 left it
  stale.

Each fix states the landed behaviour, with no history ("now", "no longer"). Run `wigley:writing-for-agents` on each
edit (`~/wigley-agents/AGENTS.md` § Workflow).

## Pointer check

After the fixes, run from the marketplace worktree:

```
cd /Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-marketplace-forms-rundown && python3 scripts/check_pointers.py --agents-root /Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-agents-forms-rundown
```

It must pass. A marketplace fix adds no second version bump: 08's 1.20.2 covers the series.

Done when: every claim above matches the landed code; the pointer check passes; each repo with a fix holds one fix
commit. A doc with no stale line gets no commit; the Proof records it as checked and true.
Commit:    one commit per repo that changed, in that repo's worktree, by pathspec. Do not push: task 10 pushes.

## Proof

