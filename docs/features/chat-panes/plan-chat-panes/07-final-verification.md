# 07 — Final verification

Status: done
Type: Task
Wave: 5 · Depends on: 06
Plan: [plan.md](plan.md)

Files:     none

Consumes:  the landed run

Produces:  the check results in this document's Proof section

Decisions:
- Run `npm run typecheck`, `npm run lint`, `npm test` and `npm run selftest`. Every one passes.
- Read the self-test screenshots `.selftest/screenshots/sessions-panes-side-by-side.png` and
  `sessions-panes-stacked.png` (the names the self-test writes) against `DESIGN.md` and
  `docs/features/chat-panes/design.md` § Look.
- Live checks, each through `npm run drive` or the self-test's screenshots:
  1. **Expected** — two panes side by side: the focused pane has the 1px `focus-border` frame, the
     other has none, and each shows its own icon tab bar with the split and close controls. Reason:
     the frame and tab look have no test.
  2. **Expected** — the on-screen row ring shows on the unfocused pane's row only. Reason: style
     only.
  3. **Low-confidence** — after `Alt+l` moves to a pane, typing reaches that pane's chat box, and
     the box keeps its draft after its frame moves between panes. Reason: the frame reparents a
     CodeMirror editor, and no test covers it.
  4. **Low-confidence** — a Docs tab in the left pane: `Alt+l` from the tree goes to the doc, and
     the next `Alt+l` goes to the right chat pane. Reason: the two-level focus chain is wired
     across plugins.
  5. **Low-confidence** — a page reload (`Cmd+r` in the dev app) brings back the same panes,
     sizes and sessions. Reason: restore order against main's first state.
  6. **Low-confidence** — a round arriving for the session in the unfocused pane takes over that
     pane, focus stays put, and the row shows its attention dot until that pane is focused.
     Reason: `apply` placement against main's mark.
  7. **Low-confidence** — in a window narrowed until the focused pane is under 560 px wide,
     `Alt+;` logs `pane too small to split` and changes nothing. Reason: the refusal reads the
     DOM's measured size, which no test drives.
- Each failed check is a finding for `wigley:make`'s review, with what the screen showed.

Done when: every command passes and each live check above has a result in Proof.
Commit:    none

## Proof

Commit none · proof: typecheck pass; npm test 4284/4284; selftest all passed; lint only pre-existing DESIGN.md + docs/keymap.md format. Screenshots: frame on focused pane only, rings on unfocused rows; stacked right-column tab icons clipped to '[', bottom-right frame short of the right edge, resize prompt overlaps swap prompt. Drive (reports/07-drive-1.md): 1 PASS, 2 PASS, 3 PASS (draft survives swap and cancelled split), 4 PASS, 5 PASS via eval location.reload() (Cmd+r key does not reload under drive), 6 FAIL partly — focus stays, attention dot right, but .form-tab .round is hidden while its pane is unfocused so the round is not drawn until focused, 7 PASS at 320px and 187px. Also: tab icon clipped at ~280-300px; in a 700px window panes were 213/187px (under the 280px least) and the right pane's close button cut off. · concerns: Findings for review: check 6 round hidden in unfocused pane; tab icon clipping in narrow panes; panes below least size in narrow window; stacked prompt overlap
