# 06 — Final verification

Status: not started
Type: Task
Wave: 5 · Depends on: 05
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/main/selftest-script.ts` when a scripted key sequence moved
Consumes:  the landed code of 01–04
Produces:  drive captures read against the rules below; a passing self-test

Decisions:

- Run `npm run selftest`. A sequence that relied on a divider stop or a whole-entry stop gets its keys fixed. Keep what the step checks.
- Drive with the fake harness, per `.agents/skills/drive/SKILL.md`. Do not use real Claude: no check here needs it.
- Fixture: a chat with a multi-paragraph reply, a list, a code block and a `fake: visual` reply. Add a reply fixture to the fake harness only if no existing reply holds several blocks.

Live checks:

- **Expected:** `j` and `k` draw the left bar on one block at a time, and `J` and `K` jump between messages. Screenshot and read.
- **Expected:** `V`, then `j` twice, tints three blocks. `<Esc>` clears the tint, and the cursor stays.
- **Expected:** `y` shows the `Copied 3 blocks` toast. Read the clipboard through `eval` where the drive allows it, else with a clipboard fake.
- **Low confidence (geometry no test covers):** wheel scroll and `<C-j>` move the cursor so that the bar stays visible, above the composer overlay. `query` each rect against the band.
- **Low confidence (focus wiring):** click a block while the box has focus, press `<Esc>`, and press `j`. The cursor moves from the clicked block.
- **Low confidence (redraw during streaming):** during `fake: visual`, the following cursor stays on the last block and no mark stays on a removed element.
- **Low confidence (mark style):** the bar and the tint read clearly on a code block and on a user card.

Done when: every check above passes and its capture is read; `npm run selftest` passes.
Commit:    one commit when a fixture or a self-test changed; else no commit

## Proof

