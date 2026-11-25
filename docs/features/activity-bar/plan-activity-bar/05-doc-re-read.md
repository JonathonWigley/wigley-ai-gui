# 05 — Doc re-read

Status: done
Type: Task
Rung: standard · doc-only: checks prose against landed code
Wave: 4 · Depends on: 03 (its places are the order the docs state), 04 (the doc re-read runs after every code task)
Plan: [plan.md](plan.md)

Files:
- modify `docs/features/activity-bar/design.md`
- modify `DESIGN.md`
- modify `AGENTS.md`
- modify `docs/keymap.md`
- modify `docs/features/layouts/design.md`
- modify `README.md`

Consumes:  the landed code of 01–04
Produces:  nothing other tasks read

Decisions:
- Read each doc in Files line by line against the landed code: member and part names, the setting's shape and
  label, token names and values, the key, the log lines, the narrow-window rule, the built-in order. The setting is two leaves,
  `shell.activityBar.groups` and `shell.activityBar.hidden`; a doc naming it as one object stays true, and the README
  names both leaves. Fix every stale
  line. None of these docs carries a planned mark, since the branch is not live until it lands.
- In `AGENTS.md` § Running and testing, the docs self-test script's mention needs no change unless the new group
  changes what it is described as covering.

Done when: every line in Files matches the code; one commit
Commit:    one commit for the group

## Proof

Commit 480367ad · proof: diff read: two stale lines fixed (peek ends on any click in the bar; shell-chrome draws dividers and Pin button); DESIGN.md, keymap.md, layouts design and README checked true; lint passes · concerns: the Pin button shows only while expanded, so the keyboard reaches it only through Space v p
