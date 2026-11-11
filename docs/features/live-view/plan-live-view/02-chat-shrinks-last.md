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
  - Each gives up height down to its head plus a floor of body. While a `shrinksLast` section draws, each other
    section is at least its head plus the floor, so a body shorter than the floor leaves blank under it. CSS has no
    `min-height` that stops at the content's height, and chat has no script for this.
  - The `shrinksLast` section then takes what is left, up to its content's height, and shrinks only past that, down
    to its head.
  - With no `shrinksLast` section drawing, or with it collapsed, today's rules are unchanged. This is the default hub
    with no playtest running, so it must not change.
- The marker: `buildPart` sets `data-shrinks-last` on the wrapper that `placeContributedPart` returns, when
  `part.shrinksLast` is true. The marker sits on the wrapper only. The layout's `SideSectionInput` and `layout.d.ts`
  stay unchanged, because the frame does not need it.
- The CSS lives in `chat.css` beside the other `.chat-side-part` rules:
  - The rules for the others are in force only while the marked wrapper draws a body and is not collapsed:
    `.chat-side-parts:has(> .chat-side-part[data-shrinks-last]:has(.chat-side-section-body > :not([hidden])):not(:has(.chat-side-section.is-collapsed)))`.
    Chat hides an empty section with `display: none` through `:has`, not with `hidden`, so `:not([hidden])` on the
    wrapper is always true and does not work.
  - The floor sits on the other wrappers (`.chat-side-part`), not on their bodies:
    `min-height: calc(var(--chat-side-head-height) + var(--wg-chat-side-section-floor))`. A floor on the body lets the
    body shrink inside a wrapper that did not.
  - `flex-shrink: 1000` on the others and `1` on the marked wrapper, so the others reach their floor first.
  - Session and Main agent keep `flex: none`. Their `[data-part]` rules must still win over the new `:has` rule;
    check the specificity.
  - The final verification's screenshot settles the look.
- The floor is a chat theme token, `side-section-floor`, kind `length`, default `64px`, read as
  `--wg-chat-side-section-floor`.
- Rewrite the hub comment in `chat.css` (17-26) so it states the `shrinksLast` order.
- Contract doc: one sentence on `shrinksLast` in `ChatSidePart`'s doc and in `addSidePart`'s doc: "A part marked
  `shrinksLast` keeps its height while the other sections give theirs up, down to a few lines each."

Pinned values: the token `side-section-floor`, `length`, `64px`. The attribute `data-shrinks-last`.

GIVEN two parts, one with `shrinksLast` WHEN a tab opens THEN only that part's wrapper carries `data-shrinks-last`
GIVEN a `shrinksLast` part whose build throws WHEN a tab opens THEN no marker is set and nothing else throws (`buildPart` guards a null wrapper)

Tests: in `side-sections.test.ts`, add a row to the existing tests that build sections in order. Use
`recordingPart(id, order)` with an option for `shrinksLast`, and assert the marker on the marked wrapper and its
absence on the others. FakeElement has no CSS engine, so the flex rules are a live check in
[09](09-final-verification.md).

Done when: `npm run typecheck` and `npm run lint` pass (lint runs the layer, composition-root and style checks). The test gate runs
`side-sections.test.ts`.

Commit: one commit for the group.

## Proof
