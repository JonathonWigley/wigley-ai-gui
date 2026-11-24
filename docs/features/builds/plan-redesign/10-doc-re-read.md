# 10 — Doc re-read

Status: done
Type: Batch
Rung: standard · a doc-only task: prose checked line by line against landed code (`plan-folder.md` § Rung)
Wave: 5 · Depends on: 03 (design.md is read against `teamcity-backend.ts`), 04 (design.md is read against `builds-local/main/`), 06 (design.md is read against `job-graph.ts`), 08 (it reads every code task's landed result; 08 is the last of them)
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
- The three app docs (`docs/features/builds/design.md`, `agent-plugin/skills/builds/SKILL.md`, `DESIGN.md`) hold no
  planned mark: they describe the plan as built. The one planned mark is in the machine skill
  `~/wigley-agents/machine-skills/teamcity-builds/SKILL.md` (line 56, "planned in the app's `redesign` plan, not built
  yet: the app ignores the entry until it lands"); it is dropped as the machine-skill bullet below says. A mark whose
  code did not land stays, and is a concern.
- `DESIGN.md`'s Builds bullet and its `↓` / `↗` copy exception were written ahead too and stand as written unless the
  `default` layout and its CSS contradict them (the table below): the `↓` / `↗` exception is the user's pinned copy,
  not a line to remove.
- Read these against the code for each doc:

  | Doc | Read against |
  |---|---|
  | `docs/features/builds/design.md` | `src/plugins/builds/contract.ts`, `builds/main/downloads.ts`, `builds/main/start.ts`, `builds/page/builds-view.ts`, `builds/page/job-graph.ts`, `builds/manifest.ts`, the builds lines of `src/plugins/keymap.ts`, `builds-teamcity/main/teamcity-backend.ts`, `builds-local/main/` |
  | `agent-plugin/skills/builds/SKILL.md` | the `downloads` parse in `src/plugins/builds/main/backend-config.ts` (`parseKinds`, 02), `builds/main/downloads.ts` |
  | `~/wigley-agents/machine-skills/teamcity-builds/SKILL.md` | the `downloads` parse in `src/plugins/builds/main/backend-config.ts` (02) and the `{version}` / `{number}` fill in `builds/main/downloads.ts` (05) |
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
Done when: every line of the four docs matches the landed code; the machine skill's line-56 planned mark is gone
           (landed on `ai` `main`); the fixes are committed.
Commit:    one commit for the group, naming each doc and what changed in it

## Proof

Commit 0094c0e2 · proof: diff read: design.md arrow direction, fixture in drive runs, Enter/Alt+l and no-job s/o lines match keymap.ts, start.ts and fixture-backend.ts; other docs checked unchanged · concerns: machine skill teamcity-builds line-56 planned mark drops in an ai worktree after the app lands (close step); Drive fetch-on-copy and DESIGN.md fg-tertiary step text unverified
