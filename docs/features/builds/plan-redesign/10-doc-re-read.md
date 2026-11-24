# 10 — Doc re-read

Status: not started
Type: Batch
Rung: standard · a doc-only task: prose checked line by line against landed code (`plan-folder.md` § Rung)
Wave: 5 · Depends on: 08 (it reads every code task's landed result; 08 is the last of them)
Plan: [plan.md](plan.md)

Files:
- modify `docs/features/builds/design.md`
- modify `agent-plugin/skills/builds/SKILL.md`
- modify `~/wigley-agents/machine-skills/teamcity-builds/SKILL.md` (the `ai` repo)
- modify `DESIGN.md`

Consumes:  the landed code of 01–08, read from the tree; the `Proof` section of each task document for its commit.
Produces:  the four docs true to the landed code; one commit.

Decisions:
- The four files are plan.md's "Docs written ahead". Each was written before its code landed, so each is a
  hypothesis (`wigley:writing-for-agents` § Doctrine before code). Read each line by line against the code it
  describes, and fix every line the code contradicts. Where the doc and the code disagree, the code wins, unless the
  code contradicts a decision in plan.md's Design Overview: then report the line and the code as a concern and do not
  edit either.
- Drop every "planned in `redesign`, not built yet" mark (or any other planned mark the docs carry) whose code has
  landed. A mark whose code did not land stays, and is a concern.
- `DESIGN.md`'s Builds bullet and its `↓` / `↗` copy exception were written ahead too; read them against the
  `default` layout and its CSS as the table below says.
- Read these against the code for each doc:

  | Doc | Read against |
  |---|---|
  | `docs/features/builds/design.md` | `src/plugins/builds/contract.ts`, `builds/main/downloads.ts`, `builds/main/start.ts`, `builds/page/builds-view.ts`, `builds/page/job-graph.ts`, `builds/manifest.ts`, the builds lines of `src/plugins/keymap.ts`, `builds-teamcity/main/teamcity-backend.ts`, `builds-local/main/` |
  | `agent-plugin/skills/builds/SKILL.md` | the `downloads` parse in `builds/main/` (02's file), `builds/main/downloads.ts` |
  | `~/wigley-agents/machine-skills/teamcity-builds/SKILL.md` | the `downloads` parse and the `{version}` / `{number}` fill (02, 05) |
  | `DESIGN.md` | `builds/layouts/default/layout.js`, `builds/layouts/default/layout.css` |

- Check each command, key, scope, part name, field name, log line and piece of copy the docs name with one grep over
  the tree per doc, chained in one call (`~/wigley-agents/AGENTS.md` § Tools, batch checks).
- `docs/features/builds/design.md` § Commands lists every command. Its rows must match `manifest.ts` one to one: the
  new `focusGraph`, `download`, `downloadFile`, `leaveGraph`, `graphLeft`, `graphRight`, `graphUp`, `graphDown`,
  `saveLog`, `openJob`, `selectJob`, `showBuild`, and no `openDetail`.
- `~/wigley-agents/machine-skills/teamcity-builds/SKILL.md` sits in the `ai` repo, outside the app's boundary scan;
  it may name the Drive folder. It landed on `ai` `main` ahead of the plan with its `downloads` advice marked
  planned. Drop that mark once the app's `main` holds the code, in its own commit in a worktree of `ai`, landed
  with `wigley-land` (`~/wigley-agents/WigleyRepos.md` § Landing). The app's docs keep the boundary rule (plan.md: no code
  names a user's path).
- Rewrite every fixed line to `wigley:writing-for-agents` (for the two skills) and to the doc's own voice.

GIVEN a doc line naming a key, command or field WHEN the tree has no such name THEN the line is fixed to the landed name
GIVEN a planned mark WHEN its code has landed THEN the mark is gone

Tests:     none: a doc change picks no test (`wigley:writing-tests` § Picking tests for a gate).
Done when: every line of the four docs matches the landed code; no planned mark of landed code is left; the fixes are
           committed.
Commit:    one commit for the group, naming each doc and what changed in it

## Proof

