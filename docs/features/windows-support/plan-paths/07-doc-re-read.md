# 07 — Doc re-read against the landed code

Status: not started
Type: Task
Wave: 4 · Depends on: 03, 04, 05
Plan: [plan.md](plan.md)

Files:     modify `AGENTS.md` · modify `docs/keymap.md` · modify `docs/features/followups.md` (each only where a line is stale)
Consumes:  the landed code of tasks 01–06
Produces:  none
Decisions: the docs written ahead (commit `eeaf4bb`) are hypotheses until checked against the code (`wigley:writing-for-agents` § Doctrine before code)

Check each line below against the landed code, fix every stale line, and commit the fixes:

- `AGENTS.md` § Architecture, the layer tree line `paths/  the POSIX and Windows adapters behind Paths, picked by
  each composition root`: the folder and the adapter names exist as written.
- `AGENTS.md` § Architecture, the **A path** bullet: the contract file, the adapters' folder, which root picks by
  what (main by the OS, the page by the served `platform`), Windows display and input rules, case-folded compares,
  and "a path relative to a scoped `Files` stays `/`-separated", each against the code.
- `AGENTS.md` § Architecture, the **An ambient service** bullet and the `src/shared/` tree line: still true now that
  `expand-home.ts` and `doc-paths.ts` are gone (search the file for both names and for `resolveInside`, and fix
  every mention).
- `docs/keymap.md` the **Cmd** bullet: `D-` is the Win key on Windows (no key code changed; check
  `src/shared/key-hints.ts` still prints `Win` for meta on Windows).
- `docs/features/followups.md` § Platform: no entry describes work this plan landed; the `Platform` record entry's
  "path rules already sit behind `services.paths`" is true.
- `src/plugins/docs/` and `docs/features/docs-browser/design.md`: any mention of `doc-paths.ts`, POSIX-only paths,
  or `python3 <script>` without `-X utf8`.

GIVEN a doc line that names a file, function or rule WHEN it is checked THEN the code holds it as written, or the line is fixed
Tests:     none (doc-only)
Done when: every line above is checked, and the fixes are committed (or the task records that none were needed)
Commit:    one commit for the group, when there is a fix

## Proof

