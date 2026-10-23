# 07 — Final verification

Status: not started
Type: Task
Wave: 5 · Depends on: 06
Plan: [plan.md](plan.md)

Files:     none modified, unless a check finds a bug (then a fix commit names the check)
Consumes:  the landed plan
Produces:  the live checks below, each passed with its capture read, or a bug named
Decisions: only the checks `wigley:writing-tests` § What earns a live run admits: what no unit test pins (CodeMirror row drawing, the description column's look, the real CLI's `initialize` timing, the pickers' and filters' feel)
Gate:      `npm run typecheck`, `npm run lint`, `npm test`, `npm run selftest` all pass first

Live checks — a drive run (`.agents/skills/drive/SKILL.md`), screenshots read:

1. **Expected — the reported bug.** `npm run drive -- start --harness claude`, `do chat.start` on a signed-in profile, then with no message sent type `/feature` in the box. The popup lists `/wigley:feature` (and `/wigley:feature-primer`) within a second of the session starting; the log shows `completions offered:` holding `/wigley:feature`. Tab inserts `/wigley:feature `. *Expected path.*
2. **Expected — descriptions.** In the same popup each row shows its description in a dim one-line column; a long description cuts with an ellipsis and the popup stays inside the window. `setting chat.completionDescriptions false`, retype `/` — rows show names only, with no restart. *Expected path; low-confidence on layout: CodeMirror row DOM and the popup's width are untested.*
3. **Low-confidence — fuzzy ranking in the popup.** `/wgft` offers `/wigley:feature` near the top; `/cost` offers `/usage` (alias). *Ranking passes through fzf and CodeMirror's `filter: false` path, which only the live popup combines.*
4. **Low-confidence — pickers.** Open the start prompt (`Space k n`), press `/`, type a scattered part of a listed folder (for example its last two letters plus one earlier letter); the best match is first and `j`/`k` move through the ranked rows. *`list-picker.ts` drawing in rank order has no test.*
5. **Low-confidence — Settings and Docs filters.** Settings mode `/` with `cmpdesc` shows the Completion descriptions row; the Keymap section `/` with a scattered command label shows that command's row; Docs mode `/` with a scattered title shows the doc under its expanded groups. *Wiring through `RowContext` and `tree-view.ts` is untested.*

Done when: every check passes with its screenshot read, or each failure is fixed and re-checked; the Proof lists each check, its result and the capture path
Commit:    only for a fix a check finds

## Proof

