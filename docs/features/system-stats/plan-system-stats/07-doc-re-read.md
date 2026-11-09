# 07 — Doc re-read

Status: not started
Type: Batch
Wave: 4 · Depends on: 01, 02, 03, 04, 05, 06
Plan: [plan.md](plan.md)

Files:     modify, only where a line is stale: `docs/features/system-stats/design.md` · `AGENTS.md` ·
           `DESIGN.md` · `docs/keymap.md` · `docs/features/session-host/design.md` ·
           `docs/features/layouts/design.md`
Consumes:  the landed code of 01–06
Produces:  each doc above true to the landed code
Decisions: the docs were written ahead in commit `1b979c24` as hypotheses (`decisions.md` § Docs);
           the code and its tests win wherever they differ
GIVEN the docs written ahead and the landed code WHEN each doc line about this feature is read
against the code THEN every line is true, and each stale one is rewritten in place

Approach:  read each file's lines the docs-ahead commit added or changed (`git show 1b979c24`)
           and check each claim against the code: names, paths, slot ids, setting keys and
           defaults, binds and scopes, the protocol version and message shapes, the commands each
           adapter runs (design.md's table), the panel's title, its order among right-bar
           contributions, and the sparkline's update path, which DESIGN.md does not yet name and
           task 06 settles. Edit with `wigley:writing-for-agents`.
Tests:     none: a doc change picks no test (`wigley:writing-tests` § Picking tests for a gate)
Done when: every claim checked; the fixes committed
Commit:    one commit, "System stats docs re-read against the landed code", or no commit when
           nothing was stale (say so in Proof)

## Proof
