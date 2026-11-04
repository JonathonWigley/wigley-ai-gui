# 04 — Usage row cache mark and short token text

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/usage/layouts/layout.d.ts` · modify `src/plugins/usage/layouts/default/layout.js` ·
           modify `src/plugins/usage/layouts/default/layout.css` · modify `src/plugins/usage/page/usage-view-model.ts` ·
           test `src/plugins/usage/page/usage-view-model.test.ts` · modify `src/plugins/usage/page/session-lines.ts` ·
           test `src/plugins/usage/page/session-lines.test.ts` · modify `src/plugins/usage/page/layout/usage-parts.ts` ·
           modify `src/plugins/usage/page/start.ts` · modify `src/plugins/usage/page/usage.css` ·
           modify `src/plugins/usage/page/layout/read-usage-layout.ts` when the compiler needs the new part
Consumes:  `SessionsPageExports.addRowPart` (tree) · `cacheExpiresAt` on session usage (tree)
Produces:  in `src/plugins/usage/layouts/layout.d.ts`:
           `export interface RowCacheInput { isCold: boolean; tooltip: string }`
           `rowCache?(parent: HTMLElement, input: RowCacheInput, kit: UsageKit): HTMLElement` on the usage `Layout`
           in `src/plugins/usage/page/usage-view-model.ts`:
           `export function rowCacheInput(snapshot: UsageSnapshot, sessionId: string, now: number): RowCacheInput | null`
           `export function rowCacheText(input: RowCacheInput | null): string`
           in `src/plugins/usage/page/session-lines.ts`:
           `export function rowCacheKind(parts: Pick<UsageParts, 'rowCache'>): SessionLineKind<RowCacheInput | null>`
           the second row part, id `usage.rowCache`, added in `start.ts` right after `usage.rowLine`
Decisions: a cache icon, `status-error` once cold, tooltip the minutes left (round 2, the user's note) · its own
           row part so the run time can sit between the meter and the mark (design doc) · the row's token text
           drops the limit: `121k`, not `121k/300k` (round 2) · it turns cold at usage's next once-a-minute redraw
           (Decided)

Behaviour:

- `rowCacheInput` returns null while the session has no `cacheExpiresAt`; then the part draws nothing. Else
  `isCold` is `cacheExpiresAt <= now`. `tooltip` is `cache cold` when cold, else `cache warm · <formatDuration(left)>
  left`, using the same `formatDuration` the status line's `lineCache` uses.
- A null input draws nothing. Change no shared type: `rowCacheKind`'s draw returns a stand-in `Drawn` for null,
  `input === null ? { element: parent, dispose() {} } : parts.rowCache(parent, input)`. The generic draw already
  disposes the last draw first, so warm → null and null → warm each leave one element or none.
- `start.ts` mirrors `rowLines` exactly: `createSessionLines({ id: 'usage.rowCache', line: rowCacheKind(parts), log:
  (line) => log(\`row cache ${line}\`), nameOf, latest })`, then `lineParts.add(...)`, then
  `sessions.addRowPart(....part)`, right after `usage.rowLine`. `lineParts.add` is what redraws the mark at the
  minute tick and forgets a removed session.
- `usage.css`: keep `.session-row-part[data-part='usage.rowLine'] { order: 2; }` and add
  `.session-row-part[data-part='usage.rowCache'] { order: 4; }`. Each plugin orders its own wrapper; `chat.rowClock`
  takes `order: 3` in task 03. Update the comment above the rules to say this.
- Update the `rowLineText` comment (`context 180k/300k` becomes `context 180k`), and the usage `layout.d.ts`
  header and `RowLineInput` comments: the row line slot and the new row cache slot, the row line's text is the
  used tokens alone, and the row line draws the zero line while the session has no usage.
- `default`'s `rowCache` draws `span.usage-row-cache` holding `kit.icon(..., 'database')` (a Codicon; check the
  name exists in the Codicons font the app ships, else pick the nearest cache or database glyph), with its `title`
  set to `tooltip` and `is-cold` set from `isCold`. CSS: `fg-secondary` while warm, `status-error` with `is-cold`.
- `rowLineInput` gives the row's context meter a `text` of the used tokens alone (`121k`). Read `contextMeter` and
  the existing token formatter, and reuse the formatter; do not change the session line's or the details' text.
- `rowCacheText` is the log text: `cache none`, `cache warm`, `cache cold`.

GIVEN `cacheExpiresAt` 120 000 ms after `now` WHEN the row cache draws THEN `isCold` is false and the tooltip names
2 minutes left
GIVEN `cacheExpiresAt` equal to `now` WHEN the row cache draws THEN `isCold` is true
GIVEN a session with usage of 180 000 of 300 000 tokens WHEN the row line draws THEN its text is `180k`

Tests:     in `usage-view-model.test.ts`, one `it.each` table for `rowCacheInput` (no expiry → null; expiry
           120 000 ms after `now` → warm, `cache warm · 2m left`; expiry at `now` → cold; expiry past → cold). Change
           the existing `rowLineInput` row's expected text from `180k/300k` to `180k`; the session line's existing
           `180k/300k` assertions stay and pin that only the row changed. In `session-lines.test.ts`, one test over
           the row cache kind: null draws nothing in the wrapper, then warm draws one element, then null leaves none.
Done when: compiles; `npm run lint` passes; the test gate runs the tests above
Commit:    one commit for the group

## Proof

Commit 10d1cf30 · proof: diff read; every Produces signature present; typecheck clean for usage · concerns: layouts design Adopters table omits the cache mark (task 06); rowCacheText and the default part title and is-cold have no test, live check 3 covers them; doubled log prefix row cache session line in, same shape as rowLine
