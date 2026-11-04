# 06 — Final verification

Status: not started
Type: Task
Wave: 5 · Depends on: 05
Plan: [plan.md](plan.md)

Files:     modify `src/shared/fake-agent-harness.ts` · modify `src/plugins/chat/main/selftest-script.ts` when a scripted key sequence moved
Consumes:  the landed code of 01–04
Produces:  drive captures read against the rules below; a passing self-test

Decisions:

- Run `npm run selftest`. A sequence that relied on a divider stop or a whole-entry stop gets its keys fixed. Keep what the step checks.
- Drive with the fake harness, per `.agents/skills/drive/SKILL.md`. Do not use real Claude: no check here needs it.
- Fixture: add `FAKE_BLOCKS_TEXT = 'fake: blocks'` to `fake-agent-harness.ts`. Its reply holds three paragraphs, a two-item list and a `ts` code block, then a normal turn end.
- Send one user message of two paragraphs: press `<S-Enter>` between them. Use `fake: visual` for the visual check.

Live checks:

- **Expected:** `j` and `k` draw the left bar on one block at a time, and `J` and `K` jump between messages. Screenshot and read.
- **Expected:** press `gg`, then `V j j`: three blocks are tinted. `<Esc>` clears the tint, and the cursor stays.
- **Expected:** before `y`, `eval` a stub of `navigator.clipboard.writeText` that stores the text on `window`. Press `gg`, `V j j`, `y`. The toast reads `Copied 3 blocks`, and `eval` reads the three blocks' source.
- **Expected:** `v` on the second visual of a `fake: visual` reply opens the overlay at `2 of 2`.
- **Low confidence (geometry no test covers):** wheel scroll and `<C-j>` move the cursor so that the bar stays visible, above the composer overlay. `query` each rect against the band.
- **Low confidence (focus wiring):** click a block while the box has focus, press `<Esc>`, and press `j`. The cursor moves from the clicked block.
- **Low confidence (redraw during streaming):** during `fake: visual`, the following cursor stays on the last block and no mark stays on a removed element.
- **Low confidence (mark style):** the bar and the tint read clearly on a code block and on a user card.

Done when: every check above passes and its capture is read; `npm run selftest` passes.
Commit:    one commit when a fixture or a self-test changed; else no commit

## Proof

