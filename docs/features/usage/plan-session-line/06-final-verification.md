# 06 — Final verification

Status: not started
Type: Task
Wave: 3 · Depends on: 05
Plan: [plan.md](plan.md)

Files:     none (captures go to the drive run's folder and `.selftest/screenshots/`)
Consumes:  everything in 01–05

## Checks

Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run selftest`. All must pass. Then do a drive run
(`npm run drive`, loop in `.agents/skills/drive/SKILL.md`). Read each capture against `DESIGN.md` § Usage and the tab
entries.

- **Expected: two panes, two lines.** Open two sessions and split so that each shows in its own pane. Seed usage
  (`usage.seed`, `variant: fresh`) on the session in the left pane. Its tab bar shows the context meter, `cache` and
  `$` text, between the tab strip and the close prompt. The right pane's tab bar shows no line. The status bar shows
  only the plan meters, with no context group and no divider. Seed again on the right pane's session. The line moves
  to the right pane: the seed replaces the snapshot, so the left session has no usage now.
- **Expected: the line follows its session.** Swap the two panes. The line moves with its session's tab bar.
- **Expected: on every tab.** Open the forms preview round (`Space z l o`). It opens in its own `layout-preview`
  session (`src/plugins/forms/main/preview/layout-preview.ts`). Seed usage on that session's id (`usage.seed` with
  `sessionId`). With the Form tab shown, the line stays in that session's tab bar.
- **Low-confidence: a narrow pane.** At a window width near the pane's least width (280 px each beside another pane),
  the line clips or shrinks. The tab strip, the close prompt and the pane controls stay whole and on one row. The CSS
  for this is new, and no test sees layout.
- **Low-confidence: a user layout.** Write a user `usage` layout that defines only `sessionLine`, with a changed
  class. Set `usage.layout` to it. The line redraws with it, with no restart. This checks the hot reload path of the
  new part.

Report each check with its capture path. There are no checks for the user: the drive run reaches every check above.

Done when: every check above passes, or each failure is reported with its capture.
Commit:    none

## Proof

