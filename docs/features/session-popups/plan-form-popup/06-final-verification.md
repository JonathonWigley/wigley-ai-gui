# 06 — Final verification

Status: not started
Type: Task
Wave: 4 · Depends on: 04
Plan: [plan.md](plan.md)

Files:     none (drive run captures under the run folder)
Consumes:  the landed code of 01–04
Produces:  a drive run per the repo's `drive` skill (`.agents/skills/drive/SKILL.md`), its captures read
Decisions: AGENTS.md § Running and testing (every change to what the app shows is driven end to end before the work is done); `wigley:writing-tests` § What earns a live run instead · each look claim with a number is settled by `query`, each picture by a screenshot taken after the slide settles; a video is optional and goes to the user's feel check

## Live checks

Expected paths:
1. A chat session (`chat.start`), then a round in it (`forms.openRound` with that session's id): screenshot after the
   slide, read it; `query` the popup root: its top offset equals 15% of the popup layer's height, computed
   `box-shadow` is `none`, its top-left and top-right radii equal `--wg-radius-lg`, its `transition-duration` equals
   `--wg-duration-slow`; the strip above is dimmed (`--wg-scrim` background).
2. `Space v f`: screenshot after the slide; the hidden bar shows the round's title and the key; the popup root is
   `inert`. Chat keys act on the chat (`j`/`k` in the transcript, their log lines). A click on the bar entry brings
   the popup back (`opened Form popup in …` line).
3. Submitting the round: the popup goes and the Chat tab's `shown` line logs; chat keys work.
4. A primer in a chat session (`primer.openPrimer` with its id): the same open, hide and show.
5. With default settings, no session shows a Docs tab (`query` the tab strip: chat tab only); Docs mode
   (`Space k d`) works.

Low-confidence paths (no test reaches them):
6. A connected session with no Chat tab: `forms.openRound` with no `sessionId` (it connects a `drive-forms-<n>`
   session; pass no `sessions.connect` id). The popup opens over the empty pane; hidden, the empty text and the bar
   show (screenshot).
7. Pane moves with a popup: answer one choice first, then `Alt+;` (split right) and `<C-A-l>` (swap), with the popup
   open and again hidden: the popup and bar move with the session (screenshot), and `query` shows the answered
   choice still picked.
8. Focus on arrival: in a chat session press `i`, `type` some text in the composer, then open a round: `query`
   `document.activeElement` is not the composer, and the next key reaches the form (its log line).
9. Narrow window: `fit 640` (the side bar's overlay width; check `SIDE_BAR_OVER_QUERY` in `src/renderer/renderer.ts`
   for the current number and use it): the popup and bar fit the pane (screenshot, `fit`'s report).

Checks for the user (wrap-up only): the slide's feel under the real compositor, and reduced motion
(`prefers-reduced-motion`) making it instant — synthetic runs cannot judge motion feel.

Done when: every check above is captured and read, and any failure is fixed or reported
Commit:    none (fixes found here commit with the group they fix, per `wigley:make`)

## Proof
