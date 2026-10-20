# 06 — Preview round

Status: not started
Type: Task
Wave: 4 · Depends on: 04
Plan: [plan.md](plan.md)

Files:     create `src/plugins/forms/main/preview/preview-round.ts` · create `src/plugins/forms/main/preview/memory-round-store.ts`
           · create `src/plugins/forms/main/preview/layout-preview.ts` · modify `src/plugins/forms/main/round-store.ts`
           · modify `src/plugins/forms/main/start.ts`
           · test `src/plugins/forms/main/preview/preview-round.test.ts` · test `src/plugins/forms/main/preview/layout-preview.test.ts`
           · test `src/plugins/forms/main/round-store.test.ts` (extend)
Consumes:  channel `openPreview` (declared) ← 04 · `RoundStore`, `createFormsService`, the channel presenter, the
           sessions export `connect` (in the tree as plan A left it)
Produces:  `export const PREVIEW_ROUND_ARGS: Record<string, unknown>` in `preview/preview-round.ts`
           `export function createMemoryRoundStore(clock: Clock, randomHex: RandomHex): RoundStore` in `preview/memory-round-store.ts`
           `recentArgs(limit: number): unknown[]` on `RoundStore` in `round-store.ts`
           `export function createLayoutPreview(deps: { sessions: Pick<SessionsMainExports, 'connect'>; forms: FormsService; savedArgs(): unknown[]; log: Log }): { open(): void }`
             in `preview/layout-preview.ts`
Decisions: the built-in sample first, then each further press swaps in the next saved real round (round 3) · the
           preview sends nothing and saves nothing (round 3 notice) · a round source with its own `FormsService` over
           the in-memory store, sharing the one presenter (design review, seam)
Commit:    one commit for the group

## The sample (`PREVIEW_ROUND_ARGS`)

These are ask_round arguments that `parseRound` accepts. They hold, in this order:

- `heading` 'Layout preview' and a one-sentence `overview`.
- One notice, badge `Decided`.
- Three findings: a `caused` defect at severity `critical` with three choices, a `design` decision with two choices,
  and a `nit` with one choice.
- Two questions:
  - a short one with three choices;
  - a long one whose context has a bullet list, a fenced code block and a `:::details` block, with six choices.

The text is the implementer's, written to show the cards (long and short titles, inline code, a choice that wraps).
It must not open a choice with an action word: `parseRound` rejects those.

## Behaviour

- `start.ts` creates the channel presenter once and passes it to both `FormsService`s, the agents' (over the real
  store) and the preview's (over `createMemoryRoundStore`), because the presenter owns the channel's `finish` and
  `draft` handlers. It registers `openPreview` → `preview.open()`. `savedArgs` is `() => store.recentArgs(20)`.
- `recentArgs(limit)`: the `args` of the newest saved rounds by `updated`, newest first, one per `fingerprint` (the
  newest), at most `limit`, skipping files that do not parse (as `newestFor` does).
- Saved args are checked with `parseRound` (from `../round`) before asking; one that throws is skipped.
- `open()`:
  - **No preview open**: connect with `{ sessionId: 'layout-preview', projectDir: 'Layout preview',
    deadlineSeconds: null, harness: null }` (plan A's `SessionInfo`; the row label is `projectDir`'s basename; if
    plan A typed `harness` without null, use its value for no harness and note it in the run log). Call `askRound(PREVIEW_ROUND_ARGS, null,
    signal)` on `forms.startSession(connected)`, and set the cursor to the sample.
  - **Preview open**: abort the open call's signal, which closes the open round. Then ask the next item: the saved
    args in `savedArgs()` order, wrapping back to the sample after the last. Saved args that fail to parse are logged
    (`preview skipped a saved round: <errorText>`, source `forms`), and the next one is tried; when none parse, the sample is
    shown again.
  - **The user submits or cancels** (the `askRound` promise settles with that outcome): end the session, so its row
    leaves the sidebar. A result whose outcome is `draft` (the deadline passed) re-waits with
    `collectLastRound(true, signal)` on the same session and controller, and its result is handled the same way, so
    the next press can still abort and the row still leaves on submit. The promise settling after an abort is
    ignored.
- Nothing reaches an agent: the preview's session has no relay, and its store is in memory.

GIVEN the preview shows the sample and two saved rounds exist WHEN `open()` runs twice more THEN the first saved round
shows, then the second.

Tests:

- `preview-round.test.ts`: `previewRoundArgs_Parse_HoldEveryCardKind` — `parseRound` accepts the args, which hold a
  notice, a defect, a decision, a nit and a question.
- `layout-preview.test.ts`, with a fake `FormsService` and `connect` (recording each `askRound`'s args and its signal):
  - `open_First_ConnectsAndAsksSample`.
  - `open_Again_AbortsAndAsksNewestSaved`: the GIVEN/WHEN/THEN above, against the test's own saved args.
  - `open_PastLastSaved_WrapsToSample`.
  - `open_SavedArgsUnparseable_SkipsAndLogs`.
  - `submit_EndsSession`.
  - `draftOutcome_RewaitsWithCollectLastRound`: the session stays, and a later submit through the re-wait ends it.
- `round-store.test.ts`: `recentArgs_NewestFirst_Limited`, `recentArgs_SkipsUnreadableFile` and
  `recentArgs_OneRecordPerFingerprint`.

Done when: compiles; `npm run lint` passes; the test gate runs the tests above.

## Proof
