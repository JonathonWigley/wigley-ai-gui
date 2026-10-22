# 04 — Doc re-read

Status: not started
Type: Task
Wave: 3 · Depends on: 01, 02, 03
Plan: [plan.md](plan.md)

The docs below were written in commit `cc4145e`, before the code. Re-read each line by line against the landed code,
fix every stale line, and commit the fixes.

Files:     modify as needed `docs/keymap.md` · `AGENTS.md` (pointer under the contents, the `src/config/` line, the
           "A key" paragraph) · `DESIGN.md` § Keys and focus · `docs/features/ui-design/design.md` (keymap.json) ·
           `docs/features/docs-browser/design.md` (the keys bullets) · `docs/features/ui-design/live-checks.md` (D2,
           D5, D13) · `docs/features/followups.md` (the plugin editor remaps item; the forms self-test gallery item,
           whose `d` becomes `<C-j>`) · `docs/features/plugin-framework/design.md` (the typed-manifest bullet: built-in
           manifests no longer declare default keys)
Consumes:  the landed code of 01, 02, 03
Produces:  docs true to the code
Decisions: rule home `docs/keymap.md` (round 1)

Check in particular:

- `docs/keymap.md` § Where keys live: the file path, section names, `where` values and defaults, `groups` — against
  `src/plugins/keymap.ts` and `expandBind`.
- `docs/keymap.md` § Leader groups table: every row against the `groups` and binds in `src/plugins/keymap.ts`.
- `AGENTS.md` "A key": the layer order, the optional manifest `keys`, and the checks.
- `docs/features/ui-design/live-checks.md` D13: the hint glyph `⌥H` against what `formatChord` prints for `<A-h>`, and
  "rebind" spelled as a bind plus an unbind of the default, since a user bind on other keys is appended and
  `keysFor` returns the first bind.

Done when: every listed doc read in full against the code; fixes committed (or "no change" recorded in Proof).
Commit:    one commit for the group, when anything changed

## Proof
