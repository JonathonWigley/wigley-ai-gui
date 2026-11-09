# 07 — Doc re-read

Status: done
Type: Batch
Wave: 4 · Depends on: 01, 02, 03, 04, 05, 06
Plan: [plan.md](plan.md)

Files:     modify, only where a line is stale: `docs/features/system-stats/design.md` · `AGENTS.md` ·
           `DESIGN.md` · `docs/keymap.md` · `docs/features/session-host/design.md` ·
           `docs/features/layouts/design.md` ·
           `.agents/skills/drive/SKILL.md`
Consumes:  the landed code of 01–06
Produces:  each doc above true to the landed code
Decisions: the docs were written ahead in commits `37740b7b`, `ea65e439` and `368e02c0` as hypotheses (`decisions.md` § Docs);
           the code and its tests win wherever they differ
GIVEN the docs written ahead and the landed code WHEN each doc line about this feature is read
against the code THEN every line is true, and each stale one is rewritten in place

Approach:  read each file's lines the docs-ahead commits added or changed (`git show 37740b7b ea65e439 368e02c0`;
           after a rebase, find them again with `git log --format='%h %s' origin/main..HEAD --` and the seven
           paths above)
           and check each claim against the code: names, paths, slot ids, setting keys and
           defaults, binds and scopes, the protocol version and message shapes, the commands each
           adapter runs (design.md's table), the panel's title, its order among right-bar
           contributions, and the sparkline's update path (04's `kit.d.ts` comment: call it again in a fresh
           parent part; 06 redraws on each snapshot), which DESIGN.md's Sparkline bullet should name, and
           the RAM meter's tone (by memory pressure where known, task 05). Edit with `wigley:writing-for-agents`.
Tests:     none: a doc change picks no test (`wigley:writing-tests` § Picking tests for a gate)
Done when: every claim checked; the fixes committed
Commit:    one commit, "System stats docs re-read against the landed code", or no commit when
           nothing was stale (say so in Proof)

## Proof

Commit 9dc539c0 · proof: Diff read: DESIGN.md Sparkline and System stats bullets, design.md § The panel match the code (sort hint, heading row, 260px narrow form, system-stats.layout setting); oxfmt --check passes on both. AGENTS.md, docs/keymap.md, session-host and layouts design docs, drive SKILL.md checked and unchanged. · concerns: design.md adapter table's Windows memory row omits Win32_PerfRawData_PerfOS_Memory, which windows-system-stats.ts reads for AvailableBytes; rides to the review.
