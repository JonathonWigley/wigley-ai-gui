# 10 — Split subscribes to its width key

Status: not started
Type: Task
Rung: hard · adds a member to the `UiState` contract every implementer and fake must carry, moves four owners off a manual reload, and the subscription must not fight a drag in progress
Wave: 4 · Depends on: 01, 08
Plan: [plan.md](plan.md)

Fixes follow-up L510 (`docs/features/followups.md`, main at 9b671bd16), **Split subscribes to its width key**:
`Split` (`src/shared/page/ui/split.ts`) subscribes to its ui-state key instead of each owner calling `reloadWidth()`
when shown, so a new split owner cannot forget it. Forms' `round-view.ts` caller is left as it is (plan.md Decision:
Lane L tasks 12–13 rewrite it); its split follows the key through the divider all the same.

Files:
- modify `src/contracts/ui-state.ts`
- modify `src/renderer/ui-state.ts`
- test `src/renderer/ui-state.test.ts`
- create `src/shared/fake-ui-state.test-support.ts`
- modify `src/shared/page/ui/split.ts`
- test `src/shared/page/ui/split.test.ts`
- test `src/shared/page/ui/split-width.test.ts`
- modify `src/renderer/shell/shell.ts`
- test `src/renderer/shell/shell.test.ts`
- modify `src/plugins/chat/page/side-sections.ts`
- test `src/plugins/chat/page/side-sections.test.ts`
- test `src/plugins/chat/page/chat-view.test.ts`
- modify `src/plugins/primer/page/primer-view.ts`
- test `src/plugins/primer/page/primer-view.test.ts`
- modify `src/plugins/docs/page/start.ts`
- modify `src/shared/plugin-part-harness.test-support.ts`
- test `src/plugins/sessions/page/session-fakes.ts`
- test `src/plugins/system-stats/page/start.test.ts`
- test `src/plugins/docs/page/starred-docs.test.ts`
- test `src/plugins/backlog/page/backlog-view.test.ts`
- test `src/plugins/gallery/page/layout/gallery-parts.test.ts`
- test `src/plugins/forms/page/forms-view.test.ts`
- test `src/plugins/forms/page/round-view.test.ts` (the `uiState` fake only; `round-view.ts` is not touched)
- modify `DESIGN.md` (the **Split** entry)

Preconditions (run from the `wigley-ai-gui/` folder of the merged `main`):

| Claim | Command | Expected |
|---|---|---|
| `UiState` has only `get` and `set` | `grep -n '^  [a-z]*(' src/contracts/ui-state.ts` | `get(key: string): unknown;` and `set(key: string, value: unknown): void;` |
| The owners that reload by hand | `grep -rn 'reloadWidth()' src --include='*.ts' \| grep -v 'test\|shared/page/ui/split.ts'` | `shell.ts` (two, in `reloadBarOpenWidths`), `primer-view.ts` (`outer`, `inner` in `update`), `round-view.ts` (one, in `update`), `side-sections.ts` (one, in `sharedWidthState.set`'s loop), `docs/page/start.ts` (one, in `shown`) |
| The theme reload is the shell's only call | `grep -n 'reloadBarOpenWidths' src/renderer/renderer.ts` | one line, inside the config push's `applier.apply` |
| The `UiState` implementers and fakes this change must extend | `grep -rln 'UiState' src --include='*.ts' \| xargs grep -ln 'get: (key) =>\|get: () => undefined'` plus the inline fakes `grep -rn "uiState: { get: () => undefined" src` | the files listed above as test/modify (notes' `popup.test.ts` casts `as unknown as PageServices` and needs no edit) |
| No subscription exists yet | `grep -rn 'uiState.on(\|UiState.*on(' src --include='*.ts' \| wc -l` | `0` |

Consumes: nothing from another group. Follows 01 in `src/plugins/docs/page/start.ts` and 08 in
`src/plugins/primer/page/primer-view.ts` (same files, earlier waves).

Produces:
- `on(key: string, listener: () => void): Disposable` on `UiState` in `src/contracts/ui-state.ts`
- `export function uiStateOver(values: Map<string, unknown>, onSet?: (key: string, value: unknown) => void): UiState`
  in `src/shared/fake-ui-state.test-support.ts`

Decisions:
- **The seam is on `UiState`, required.** The item asks the split to subscribe, and `UiState` (`get`/`set`) is all a
  split holds, so the store gains `on(key, listener): Disposable`, named after the repo's `on(listener)` readers
  (`KeyedSlotReader`). It is required, not optional: an optional member lets a wrapper drop it and its splits silently
  stop following, which is the bug the item removes; the compiler then makes each wrapper (`openWidthState` in
  `shell.ts`, `sharedWidthState` in `side-sections.ts`) forward it. Contract comment, appended to the existing one:
  "`on` calls `listener` after each `set` of `key` through any scope of this plugin's prefix in this page, the setter's
  own included, and returns the `Disposable` that stops it; a set in another window's page is not heard."
- **The page store.** `createPageUiState` keeps one `Map<string, Set<() => void>>` keyed by the qualified key, shared
  by every `scoped` object of the page, so two `scoped('docs')` objects hear each other. `set` updates `values`,
  calls `write`, then calls a copy of that key's listeners (a listener that disposes during the call does not skip
  another). The comment's first sentence gains "and calls the key's `on` listeners".
- **The divider subscribes.** `createSplitDivider` subscribes `options.uiState.on(options.stateKey, …)` with the body
  of `reloadWidth` (shows the stored width unless a drag holds the pointer) and disposes the subscription in its
  `dispose`. The writer hears its own set: at a drag's end and after a nudge the stored width equals the drawn one, so
  the redraw shows the same width. `createSplit` gets the subscription through the divider; nothing in it changes but
  comments.
- **`reloadWidth` stays on both interfaces.** `SplitDivider.reloadWidth` is still needed: the shell's
  `reloadBarOpenWidths` answers a theme's token change, which is no `set` of the key (`openWidthState` reads the token
  while no width is stored). `Split.reloadWidth` stays for forms' `round-view.ts` until Lane L drops that call. Its
  comment becomes: "Shows the width stored under `stateKey` now. The split already follows every `set` of its key, so
  only a width that changed without one (a theme's token) needs it; a drag in progress keeps its own." `createSplit`'s
  comment: "`reloadWidth` reads it again" becomes "every split over one `stateKey` follows a width any of them
  stores".
- **The owners.** `primer-view.ts` drops `outer.reloadWidth(); inner.reloadWidth();` and the comment above them from
  `update`. `docs/page/start.ts` drops `split.reloadWidth();` and its comment from `shown`. `side-sections.ts`'s
  `sharedWidthState` keeps its log line, drops the loop over `openTabs` (each tab's divider now hears the set itself),
  and forwards `on`; its comment becomes "Every tab's divider writes through this and follows the key, so one drag
  moves every tab's hub." The shell's `openWidthState` forwards `on: (key, listener) => uiState.on(key, listener)`;
  `reloadBarOpenWidths` is unchanged.
- **One notifying fake.** Seven fakes become `uiStateOver(map, onSet?)` rather than seven listener maps:
  `uiStateOver` gets and sets over `values` (`set(key, undefined)` deletes), calls `onSet` after each set, and
  notifies `on` listeners as the page store does. Users: `split.test.ts` and `shell.test.ts` (`stateOver` becomes it),
  `split-width.test.ts` (`stateOver(record)` → `uiStateOver(new Map(Object.entries(values)))`),
  `side-sections.test.ts`'s `fakeUiState`, `primer-view.test.ts` (`uiStateOver(uiValues, (key, value) =>
  uiWrites.push([key, value]))`), `plugin-part-harness.test-support.ts` (`uiStateOver(record.uiState)`),
  `session-fakes.ts`'s `fakeUiState(entries)` (`uiStateOver(new Map(entries))`, keeping its name and signature for its
  callers), `system-stats` `start.test.ts` and `starred-docs.test.ts` (their recording `set` moves into `onSet`). The
  four inline `{ get: () => undefined, set: () => undefined }` fakes (`backlog-view.test.ts`, `gallery-parts.test.ts`,
  `forms-view.test.ts`, `round-view.test.ts`) and `chat-view.test.ts`'s become `uiStateOver(new Map())`.
- **Docs.** `DESIGN.md`'s **Split** entry, after "written when a drag ends and on each keyboard resize": add "; every
  split over the same key follows a width any of them writes".

GIVEN a page store WHEN `scoped('forms').on('rail', l)` and then `scoped('forms').set('rail', 300)` THEN `l` ran once;
a set of `forms.other` or `chat.rail` does not call it; a set of `rail` through a second `scoped('forms')` object calls
it; after the `Disposable` is disposed a set does not.

GIVEN two splits over one store and one `stateKey` WHEN the first is nudged right (its width 240 → 264, written) THEN
the second's `width()` is 264 with no `reloadWidth` call.

GIVEN two splits over one key WHEN the second holds a drag at 300 and the first writes 350 THEN the second keeps 300.

GIVEN a disposed split WHEN another split writes its key THEN the disposed one's width is unchanged.

GIVEN two docs views WHEN a split width is stored under the docs split's key by one of them THEN the other's split
shows it before its next `shown` (proved through the split test above; the docs page holds no width test today and
the harness does not drive a drag).

Tests:
- `ui-state.test.ts`: `it.each` `'on hears a set of its own key only: $case'` — rows `same scope` (1 call), `another
  scope object of the prefix` (1), `another key` (0), `another prefix` (0), `after dispose` (0).
- `split.test.ts`, describe `createSplit follows its key`: `'a split takes the width another split over its key
  stores'` (two splits on one `uiStateOver`, nudge the first `right`, second `width()` `limits.initial +
  SPLIT_NUDGE_STEP`, i.e. 264); `'a drag in progress
  keeps its width when another split stores one'` (second pressed and moved to 300, first's store `set('side', 350)`,
  second `width()` 300); `'a disposed split no longer follows its key'` (dispose, `set('side', 350)`, width stays
  240). The two `createSplit reloadWidth` tests stay, now storing through `state.set`.
- `side-sections.test.ts`: `'a drag on one hub handle widens every tab, keeps the width, and a later tab reads it'`
  passes unchanged over the notifying fake (it fails if the divider does not subscribe, since the loop is gone).
- `primer-view.test.ts`'s `primer column widths` table passes unchanged (writes `tasks-width` 300 and
  `primer-rail-width` undefined).

Done when: compiles (`npm run typecheck`); `npm run lint` passes (the layer check admits
`src/shared/fake-ui-state.test-support.ts` from every importer); `npm test` runs `ui-state.test.ts`, `split.test.ts`,
`split-width.test.ts`, `shell.test.ts`, `side-sections.test.ts`, `chat-view.test.ts`, `primer-view.test.ts`, the docs
and sessions `start.test.ts` suites and every other edited test file green; `grep -rn 'reloadWidth()' src --include='*.ts'
| grep -v test` lists only `shell.ts` (two) and `round-view.ts` (one) besides `split.ts`.

Commit: one commit, "Split follows its ui-state key: UiState gains on(key), every split over one key takes a width
any of them stores, and primer, docs and chat's hub drop their manual reloads (follow-up L510)".

## Proof

