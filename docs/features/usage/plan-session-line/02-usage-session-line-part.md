# 02 — Usage session line part

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/usage/manifest.ts`, `src/plugins/usage/page/layout/read-usage-layout.ts`, `src/plugins/usage/layouts/layout.d.ts`, `src/plugins/usage/layouts/default/layout.js`, `src/plugins/usage/page/usage.css`, `src/plugins/usage/page/usage-view-model.ts`, `src/plugins/usage/page/layout/usage-parts.ts` · test `src/plugins/usage/page/usage-view-model.test.ts`
Consumes:  none
Produces:  `sessionLine?(parent: HTMLElement, input: SessionLineInput, kit: UsageKit): HTMLElement` on `Layout` in `src/plugins/usage/layouts/layout.d.ts`
           `StatusLineInput` without `session` in `src/plugins/usage/layouts/layout.d.ts`
           `export function sessionLineInput(snapshot: UsageSnapshot, sessionId: string, now: number): SessionLineInput | null` in `src/plugins/usage/page/usage-view-model.ts`
           `export function sessionLineText(input: SessionLineInput): string` in `src/plugins/usage/page/usage-view-model.ts`
           `sessionLine(parent: HTMLElement, input: SessionLineInput): Drawn` on `UsageParts` in `src/plugins/usage/page/layout/usage-parts.ts`
Decisions: the status bar keeps only the plan rows (round 1 notice) · the line shows context, cache and spend (round 1 notice) · no usage means no line (round 2 notice)

## Changes

- **Contract** (`layout.d.ts`): remove `session` from `StatusLineInput` and update its comment. `SessionLineInput`
  keeps its fields; its comment says that it is one session's line. Add the `sessionLine` part: it draws one session's
  line into the bar slot that sessions gives it. It is drawn only while that session has usage. Update the header
  comment of the file: the app keeps the status-bar slot, the right-bar slot and each session's bar slot.
- **Default layout**: `statusLine` draws only the plan groups or the note, with no session group and no divider.
  `sessionLine` draws `span.usage-session-line`, which holds the context meter, the context text, then the cache text
  and the spend text when they are not null, with the same classes as the old session group. Update the header comment.
- **CSS** (`usage.css`, read `DESIGN.md` § Usage first): style `.usage-session-line` for the tab bar. Use `text-12`,
  inline, one line, `white-space: nowrap`, gaps from the spacing tokens. Remove the `.usage-divider` rule if nothing
  draws it any more.
- **View model**: `statusLineInput` drops `session`, but it still reads the shown session to pick the plan.
  `statusLineText` returns only the plan text (`work: 5h 42%, Week 61%`). `sessionLineInput` returns null when the
  snapshot has no such session or that session's `usage` is null; otherwise it returns today's private `sessionLine`
  result. `sessionLineText` returns `context 180k/300k, cache 42m, spend $1.23`, with each part left out on the
  same rules as today's text. Update the comments.
- **Parts**: `UsageParts.sessionLine` draws the `sessionLine` part, as `statusLine` does. Add `sessionLine: true`
  to `LAYOUT_PARTS` in `read-usage-layout.ts`, so a user layout may define it.
- **Manifest**: the header comment and the `layout` setting's description name the three surfaces: the status-bar
  plan line, each session's line in its tab bar, and the details. The description is user-facing text:
  `The layout that draws the status-bar plan line, each session's usage line and the usage details: a folder in the layouts/usage folder, or default.`
- In `layout.d.ts`, update every comment that says the status line carries the session (the `StatusLineInput`
  comment, and the `Layout` comment on what `statusLine` draws).

GIVEN a snapshot whose session `s1` has usage WHEN `sessionLineInput(snapshot, 's1', now)` runs THEN it returns the
context meter, cache and spend.
GIVEN the same snapshot WHEN it runs for `s9` (absent), or for a session whose `usage` is null THEN it returns null.

Tests (`usage-view-model.test.ts`):
- In the `statusLineInput_Profile_$case` table, remove the `hasSession` column. The rows keep their profile and plan
  assertions.
- Move the session cases of the status line tables (context meter tones, the limit fallback, cache cold, null spend)
  to `sessionLineInput`. They become rows of one `sessionLineInput_$case` table, plus rows for the absent session and
  the null-usage session that expect null.
- In `log text`, the status line rows assert only the plan text. Add a `sessionLineText_$case` table with rows for
  everything present, no cache, and no spend.
Done when: `npm run typecheck`, `npm run lint` and `usage-view-model.test.ts` pass.
Commit:    one commit for the group

## Proof

