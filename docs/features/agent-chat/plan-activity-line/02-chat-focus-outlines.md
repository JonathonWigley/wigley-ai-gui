# 02 — Chat focus outlines

Status: not started
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/page/chat.css` · modify `src/plugins/chat/page/chat-view.ts`
Consumes:  none
Produces:  class `is-box-focused` on the Chat tab's root `div.chat-tab` while its message box has focus
Decisions: the user's answer, binding: chat only; while the box has focus the box draws no focused frame and no entry is marked; once the box loses focus the focused entry shows a thin left bar in place of today's inset ring; other views keep the ring (DESIGN.md § Keys and focus, written ahead)
           `chat-view.ts`: in `createTab`, the editor's existing `focused` and `blurred` callbacks (which set `tab.isBoxFocused`) also toggle `is-box-focused` on `tab.root`. No new state field
           `chat.css`, `.chat-entry-slot.is-cursor`: today `border-radius: var(--wg-radius-md)` and `box-shadow: inset 0 0 0 1px var(--wg-focus-border)`. After: `box-shadow: inset var(--wg-indicator-width) 0 0 var(--wg-focus-border)` and no radius
           `chat.css`: `.chat-tab.is-box-focused .chat-entry-slot.is-cursor` draws no box-shadow
           `chat.css`: `.ui-input.chat-box:focus-within` sets `border-color: var(--wg-input-border)`. The compound selector outranks `.ui-input:focus-within` and `.ui-input:hover` in `src/shared/page/ui/input-frame.css`, whatever order the stylesheets load in; `input-frame.css` does not change
           the chat's CSS comment above the slot rules says the chat exception in one line
GIVEN the Chat tab with its box focused WHEN the user presses Esc THEN the focused entry shows the left bar; GIVEN the box focused THEN no entry shows a bar and the box frame is at rest — a live check in 10, no unit test (styling; `wigley:writing-tests` § What earns neither)
Tests:     none
Done when: compiles; `npm run lint` passes (style check: tokens only)
Commit:    one commit for the group

## Proof

