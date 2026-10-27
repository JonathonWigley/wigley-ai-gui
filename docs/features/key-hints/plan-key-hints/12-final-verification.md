# 12 — Final verification

Status: not started
Type: Task
Wave: 5 · Depends on: 11
Plan: [plan.md](plan.md)

Files:     none modified, unless a check fails and its fix is dispatched
Consumes:  everything above
Produces:  the run's verification report
Decisions: the agent runs every check its tooling reaches (`~/wigley-agents/AGENTS.md` § Checks for
           the user). A check that only a real keyboard or the user's eyes can settle goes in the
           wrap-up and nowhere else. Each failed check gets a fix through a dispatch, and then the
           check runs again.

## Checks the agent runs

1. `npm run lint`, `npm run typecheck`, `npm test`.
2. `npm run selftest`. It passes with no `[keys] unplaced` line (expected path: task 10's gate
   proves every built-in bind has an anchor). Read the saved screenshots in
   `.selftest/screenshots/` against `DESIGN.md` § Keys and focus and § Surfaces.
3. A drive run (`.agents/skills/drive/SKILL.md`). Seed with `sessions.open`, `forms.openRound`,
   `primer.openPrimer`, `chat.start` and `docs.seed` as the skill describes. Take a screenshot for
   each check and read it:
   1. **No status bar** (expected): on the Sessions mode with a Form tab, the window bottom shows no
      bar. `query .shell-status-bar` reports a height of 0 or `display: none`.
   2. **Edge prompts** (expected): the session list header shows `⌥⇧I ▲ ▼ ⌥⇧O`; the tab strip shows
      `⌥I ‹`, `› ⌥O` and `⌘W`; the Form rail header shows the open count, the saved state and
      `⌥P ◂ ▸ ⌥N`; the card header shows `⌃H ‹ … › ⌃L`.
   3. **One target hides a pair** (low-confidence: depends on live session and tab counts): with one
      session open, the session bumper pair is hidden; with a second session, it shows.
   4. **Hints follow the scope** (low-confidence: scope changes across panes have no test over the
      DOM): in the Primer tab, the rail's cursor-row prompt shows while `primer.rail` is in force;
      after `⌥L`, it hides, the card's hints show, and the rail rows keep their positions (compare
      the two screenshots' row boxes with `query`).
   5. **Cursor prompts** (expected): in Docs mode, the cursor row shows `s star  r rename  d trash`
      and moving the cursor with `j` moves the prompt to the new row only.
   6. **Prompts with Kbd** (low-confidence: rewritten from plain text): open the Docs trash question
      (`d`) and read that its `y` and `n` draw as Kbd.
   7. **Chat** (expected): the composer shows `i`, the control chips show `m`, `e`, `o`, `c`, and
      the running indicator shows `⌃C stop` while a fake-harness turn runs.
   8. **Settings and Gallery** (expected): Settings shows `/ filter`, the split edge prompts and the
      cursor-row prompts; Gallery shows `t transparency` and a KeyPrompt in every state.
   9. **Rebind reaches a hint** (low-confidence: anchors redraw on keymap change): write a
      `keymap.json` in the run home that binds `sessions.nextTab` to `<A-u>`; the tab strip prompt
      changes to `⌥U` with no reload.
   10. **The switch** (expected): `setting keys.showHints false` hides every anchored hint; `true`
       shows them again. Help (`Space ?`) still lists every key.
   11. **Config badge** (low-confidence: moved from the status bar): write a broken `settings.json`
       in the run home; the title bar shows the error badge and a toast; fixing the file removes
       the badge.
   12. **Keys button** (expected): the title bar shows the Keys button with `Space ?`; a click opens help.
   13. **Narrow window** (low-confidence: edge prompts add width to headers): `resize` to 680 px
       wide and 640 px wide; no header clips its prompts and the self-test fit rule holds.
4. `npm run drive -- quit`.

## Checks for the user's wrap-up

- The look of every surface in a visible `npm start`, in the user's own theme, in both transparency
  settings: the prompts read as part of the screen and stay calm (`DESIGN.md` § Intent).
- Real keyboard: `⌥⇧O`, `⌥O`, `⌃L` and `⌥N` each move what their prompt points at, and the prompt
  glyphs match the keys pressed.

Tests:     the checks above.
Done when: every check in "Checks the agent runs" passes, and the wrap-up lists the user's checks.
Commit:    none, unless a fix lands (its own commit).

## Proof
