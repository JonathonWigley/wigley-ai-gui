# 03 — Usage draws each session's line

Status: in progress
Type: Task
Wave: 2 · Depends on: 01, 02
Plan: [plan.md](plan.md)

Files:     create `src/plugins/usage/page/session-lines.ts` · test `src/plugins/usage/page/session-lines.test.ts` · modify `src/plugins/usage/page/start.ts`, `src/plugins/usage/main/selftest-script.ts`
Consumes:  `SessionPart`, `addBarPart(part: SessionPart): Disposable` ← 01
           `sessionLineInput`, `sessionLineText`, `UsageParts.sessionLine` ← 02
Produces:  `export interface SessionLines { part: SessionPart; redraw(snapshot: UsageSnapshot, now: number): void; forget(sessionId: string): void }` in `src/plugins/usage/page/session-lines.ts`
           `export function createSessionLines(deps: SessionLinesDeps): SessionLines` in `src/plugins/usage/page/session-lines.ts`
Decisions: usage registers one bar part (round 1) · redraw on each snapshot, layouts set and minute tick (round 2 notice) · follow `agents/page/subagent-lines.ts`

## Changes

- **`session-lines.ts`**. `SessionLinesDeps` holds `parts: Pick<UsageParts, 'sessionLine'>`, `log: (line: string) => void`
  and `latest(): { snapshot: UsageSnapshot; now: number } | null`.
  - `part.build(wrapper, sessionId)` keeps the wrapper for that session and draws its line from `latest()`. It returns
    a `dispose` that disposes the drawn line and drops the wrapper when the wrapper is still the one held. A tab bar
    redraw disposes the old wrapper's part first, then builds the new one (`session-tabs-view.ts`, `redrawPane`).
  - `redraw(snapshot, now)` draws every held session's line again. For each draw: dispose the last line, then draw
    `parts.sessionLine(wrapper, input)` when `sessionLineInput` is not null, else nothing. Use `callEach`, as
    `start.ts` does.
  - After each draw, log `session line <sessionId>: <text>` when the session's text differs from the last one
    logged for it. The text is `sessionLineText(input)`, or `none` while the input is null. The logged texts are
    kept by session id, apart from the wrappers, so a tab bar rebuild logs nothing new. A session with no logged
    text counts as `none`, so a session that never had usage logs nothing.
  - `forget(sessionId)` drops the session's logged text and wrapper. `start.ts` calls it on
    `sessions.sessionRemoved` (add that event to the page part's `Heard` type).
  - The part id is `usage-session-line`.
- **`start.ts`**: create the lines with `parts` and a `latest` that reads the page's `snapshot` and
  `services.clock.now()`, and add the part with `sessions.addBarPart(lines.part)`. `redraw` calls
  `lines.redraw(snapshot, now)` with the same `now` as the status line. Update the header comment: the page also draws
  each session's line in its tab bar.
- **`selftest-script.ts`**: set `scrollsItself: ['.session-bar-parts']`. The fit check runs at the minimum width,
  where the line clips in its own box by design. The run's `shownLine` becomes the session line that the fresh fixture draws:
  `[usage] session line ${sessionId}: context 180k/300k, cache 42m, spend $1.23`, built in `open` from the id that
  `connect` returns. The constant `FRESH_STATUS_LINE` goes away. The `details` group's `why` and the `narrow` group's
  `why` say "the status line and the session line" where they now say "the status line". Update the comment above
  `usageSelfTestScript`: it activates the row so that a pane shows the session and its tab bar draws the line.

GIVEN a session with usage WHEN its bar part builds THEN its wrapper holds one `usage-session-line` and the log has
`session line <id>: context …`.
GIVEN a session with no usage WHEN its bar part builds THEN its wrapper stays empty.
GIVEN a held line WHEN `redraw` runs with a later snapshot THEN the old line is disposed and the new text is logged
once. A second `redraw` with the same text logs nothing.
GIVEN a drawn line WHEN its tab bar redraws (dispose, then build into a new wrapper) THEN the new wrapper holds the
line and the log has no new line.

Tests (`session-lines.test.ts`; model the fakes on `agents/page/subagent-lines.test.ts`):
- `build_SessionWithUsage_DrawsLineAndLogs`
- `build_SessionWithoutUsage_DrawsNothing`, with rows for an absent session and a null `usage`
- `redraw_TextChanges_RedrawsAndLogsOnce`
- `rebuild_DisposeThenBuild_DrawsInNewWrapperAndLogsNothing`
- `forget_ThenUsageAgain_LogsTheLineAgain`
Done when: `npm run typecheck`, `npm run lint`, `session-lines.test.ts`, and the usage self-test group pass
(`npm run selftest`; the run's report shows `group usage:` with no failure).
Commit:    one commit for the group

## Proof

