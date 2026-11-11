# 02 — Chat side part option `shrinksLast`

Status: not started
Type: Task
Rung: hard · adds the `ChatSidePart.shrinksLast` contract member that 06 consumes, and the flex rules leave a layout choice
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Repo: wigley-ai-gui, worktree `/Users/jonathonwigley/Documents/ai-dev/.worktrees/wigley-ai-gui-live-view`.

Files:
- modify `src/plugins/chat/contract.ts`: `ChatSidePart` (~775-785), its doc (~766-774), and `addSidePart`'s doc (~828-840)
- modify `src/plugins/chat/page/side-sections.ts`: `buildPart`
- modify `src/plugins/chat/page/chat.css`: the hub comment (17-26), `.chat-side-part` (65-77), and the section and body rules (92-134)
- modify `src/plugins/chat/manifest.ts`: `themeTokens`, for the floor token
- test `src/plugins/chat/page/side-sections.test.ts`

Consumes: nothing.

Produces: `readonly shrinksLast?: true` on `ChatSidePart` in `src/plugins/chat/contract.ts`.

Decisions:
- The behaviour is the one written ahead in `docs/features/chat-bar/design.md` § The session hub, Height:
  - While a `shrinksLast` section shows, the sections that share the column give up height first. These are every
    section except Session and Main agent, which stay `flex: none`.
  - Each gives up height down to its head plus a floor of body. A section whose body is shorter than the floor keeps
    its body's height and does not grow.
  - The `shrinksLast` section then takes what is left, up to its content's height, and shrinks only past that, down
    to its head.
  - With no `shrinksLast` section shown, today's rules are unchanged.
- The marker: `buildPart` sets `data-shrinks-last` on the wrapper that `placeContributedPart` returns, when
  `part.shrinksLast` is true. The marker sits on the wrapper only. The layout's `SideSectionInput` and `layout.d.ts`
  stay unchanged, because the frame does not need it.
- The CSS lives in `chat.css` beside the other `.chat-side-part` rules, selected on `[data-shrinks-last]` and on
  `.chat-side-parts:has(> .chat-side-part[data-shrinks-last]:not([hidden]))` for the others. One way: give the others
  a much larger `flex-shrink` than the `shrinksLast` wrapper, so they reach their floor first. The implementer picks
  the rules. The final verification's screenshot settles the look.
- The floor is a chat theme token, `side-section-floor`, kind `length`, default `64px`, read as
  `--wg-chat-side-section-floor`.
- Rewrite the hub comment in `chat.css` (17-26) so it states the `shrinksLast` order.
- Contract doc: one sentence on `shrinksLast` in `ChatSidePart`'s doc and in `addSidePart`'s doc: "A part marked
  `shrinksLast` keeps its height while the other sections give theirs up, down to a few lines each."

Pinned values: the token `side-section-floor`, `length`, `64px`. The attribute `data-shrinks-last`.

GIVEN two parts, one with `shrinksLast` WHEN a tab opens THEN only that part's wrapper carries `data-shrinks-last`

Tests: in `side-sections.test.ts`, add a row to the existing tests that build sections in order. Use
`recordingPart(id, order)` with an option for `shrinksLast`, and assert the marker on the marked wrapper and its
absence on the others. FakeElement has no CSS engine, so the flex rules are a live check in
[09](09-final-verification.md).

Done when: `npm run typecheck`, `npm run lint` and `npm run check` pass, the style check included. The test gate runs
`side-sections.test.ts`.

Commit: one commit for the group.

## Proof
