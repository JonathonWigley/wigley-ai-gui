# 11 — Re-read the docs written ahead against the landed code

Status: done
Type: Task
Wave: 5 · Depends on: 01, 02, 03, 04, 05, 06, 07, 08, 09, 10
Plan: [plan.md](plan.md)

Files:     modify, where a line is stale: `AGENTS.md` · `.agents/skills/drive/SKILL.md` · `docs/features/followups.md`
Consumes:  every task's landed code
Produces:  docs true to the code
Decisions: the docs were written ahead in 6e65c67 and are hypotheses until checked (`wigley:writing-for-agents`
           § Doctrine before code)

## Behaviour

Check each line 6e65c67 added or changed against the code, and fix each one that is stale:

- `AGENTS.md` § Running and testing: group `why` printing, the `width` hold and its restore, `'start'` (add it if the
  paragraph lacks it), `repeat` and its `<name>-<n>` files, against `src/main/selftest.ts` and
  `src/main/selftest-config.ts`
- `AGENTS.md` § Dev quirks: the lock file's path and who takes it, against `scripts/start-lock.mts`, `drive.mts`,
  `selftest.mts`
- `.agents/skills/drive/SKILL.md`: the navigation rejection and capped re-poll (against `electron-driven-window.ts`
  and `page-driver.ts`), the start lock, `drag --hold` / `release` and their rejection wording (against
  `drive-commands.ts` and `drive-args.mts`)
- `docs/features/followups.md`: the restart entry and the per-run build entry still describe the code's state; leave
  the closing of step-2 entries to `wigley:make`'s Close

Done when: every line above checked; stale lines fixed and committed, or the check recorded as clean in the Proof
Commit:    one commit for the group, when anything changed

## Proof

Commit a1515bb · proof: every listed line checked; AGENTS.md running/testing and dev quirks, drive SKILL.md navigation, lock, drag rejections and loadStates, DESIGN.md gallery names fixed; wait-log and per-run build entry clean; lint passes · concerns: followups.md restart entry, hidden-tree entry (line ~41) and fixture entry (line ~37) now describe resolved states, left for Close; new doc lines exceed the files' wrap width
