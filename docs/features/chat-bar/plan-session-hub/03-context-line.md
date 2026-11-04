# 03 — Context line

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/usage/page/start.ts` · modify `src/plugins/usage/page/session-lines.ts` · modify `src/plugins/usage/page/usage-view-model.ts` · modify `src/plugins/usage/page/layout/usage-parts.ts` · modify `src/plugins/usage/page/layout/read-usage-layout.ts` · modify `src/plugins/usage/layouts/layout.d.ts` · modify `src/plugins/usage/layouts/default/layout.js` · modify `src/plugins/usage/layouts/default/layout.css` · modify `src/plugins/usage/main/selftest-script.ts` · modify the comments in `src/plugins/usage/manifest.ts`, `src/plugins/usage/contract.ts` and `src/plugins/usage/page/session-line-parts.ts` · test `src/plugins/usage/page/session-lines.test.ts` · test `src/plugins/usage/page/usage-view-model.test.ts` · test `src/plugins/usage/layouts/default/layout.test.ts` · test `src/plugins/usage/main/selftest-script.test.ts`
Consumes:  `chat.addComposerPart`, `chat.addStatusPart`, `sessionLineInput`, `createSessionLines` (in the tree)
Produces:  in `src/plugins/usage/layouts/layout.d.ts`:
           `export interface ContextLineInput { context: MeterInput; cache: string | null; compacting: string | null; compactingElapsedMs: number | null }`
           `export interface SpendLineInput { spend: string | null }`
           `Layout.contextLine?(parent, input: ContextLineInput, kit)` and `Layout.spendLine?(parent, input: SpendLineInput, kit)`, in the shape of `sessionLine`
           in `src/plugins/usage/page/session-lines.ts`: `contextLineKind(parts)`, `spendLineKind(parts)`, and a `label: string` member on `SessionLineKind<I>`
           in `src/plugins/usage/page/usage-view-model.ts`: `contextLineInput`, `contextLineText`, `spendLineInput`, `spendLineText`
Decisions:
- `usage/page/start.ts:120` today adds one status part, `usage.sessionLine`. It adds two parts after this task: `chat.addComposerPart` with id `usage.contextLine`, and `chat.addStatusPart` with id `usage.spend`.
- Both go through `createSessionLines` and `lineParts`, so they redraw on the snapshot and on the minute tick as today. `forget` reaches both.
- The composer part has no stop. `src/plugins/page.ts` starts `usage` after `agentStrip`, so the context line sits under the strip. Leave that order.
- `sessionLinePart` and the `sessionLine` layout part stay whole for `usage-tab-line`. That plugin does not change.
- `SessionLineKind` gains `label`. `createSessionLines` logs `` `${line.label} in ${name}: ${text}` ``. The labels: `session line` for `sessionLineKind` and for `rowLineKind`, so the existing log lines stay the same; `context line` for the context kind; `spend` for the spend kind.
- `contextLineText` reads `context 180k/300k, cache 42m`, and `compacting · autocompact, context 180k/300k, cache 42m` while the session compacts. `spendLineText` reads `$1.23`, or `none` with null spend.
- `contextLineInput` and `spendLineInput` read `sessionLineInput` and pick their fields, so the zero line (`0k`) and every value stay as they are.
- The default `contextLine` draws `span.usage-context-line`: the `compacting` tag and `--usage-compacting-elapsed` as `sessionLine` does, then the meter, the context text and the cache text. Override the meter inside it: `.usage-context-line > .ui-meter { flex: 1 1 auto; width: auto; min-width: calc(var(--wg-space-8) * 1.5); }`. The tag and the texts are `flex: none`, with no ellipsis. The line never drops an item, because the composer's least width holds them.
- The compacting pulse keeps its rule, extended to `.usage-context-line.is-compacting`.
- The default `spendLine` draws `span.usage-text` with the spend. With null spend it returns an empty `span.usage-text` with `hidden = true`, because a part must return an element appended to its parent. The status part's wrapper keeps its gap: spend is null only until the first usage.
- Rewrite each comment that says the Chat status line holds the session line, so that it names only the tab bar: `layout.d.ts`'s header and `sessionLine` comment, `layout.js`'s header, `layout.css`'s `.usage-session-line` comment, `manifest.ts`, `contract.ts`'s `sessionLinePart`, `start.ts`'s header, `session-lines.ts`'s `part`, and `session-line-parts.ts`. Add `contextLine` and `spendLine` to `read-usage-layout.ts` and `usage-parts.ts`, in the shape of `sessionLine`.
GIVEN a snapshot with context, cache and spend WHEN the parts draw THEN the composer part reads context and cache and the status part reads spend
GIVEN a session that compacts WHEN the context line draws THEN its text starts `compacting · autocompact, ` and the spend line does not change
GIVEN a session with null spend WHEN the spend part draws THEN it logs `spend in <name>: none` and shows no text
GIVEN a session with no usage WHEN the context line draws THEN it reads the zero line's text
Tests:     in `usage-view-model.test.ts`, one table for `contextLineText` and `spendLineText` with rows: cache and spend present, cache null, spend null, compacting. In `session-lines.test.ts`, add a row that the context kind logs `context line in <name>: …`, so the `label` member is pinned. In `layout.test.ts`, rows for `contextLine` compacting (chip first, `is-compacting`, the elapsed property), not compacting (meter, context text, cache text), null cache; and for `spendLine` with spend and with null spend (`hidden` is true). In the self-test, `FRESH_LINE` becomes `context line in …: context 180k/300k, cache 42m`, and `shownLine` reads it, with `selftest-script.test.ts`'s expected string changed to match. `/^\[usage\] spend in usage-selftest: \$1\.23$/` joins `alsoShown`. Later steps expect only the context line, because the spend text does not change and is not logged again. `COMPACTING_LINE` becomes the context line while compacting. `COMPACTING_TAB_LINE` does not change. The `narrow` group's `why` becomes: `In a narrow window the status line keeps every profile stacked, and the right bar lies over the content at its least width.`
Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above. The bar's width is a check in [09](09-final-verification.md)
Commit:    one commit for the group

## Proof

