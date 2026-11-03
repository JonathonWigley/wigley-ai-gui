# 09 — Final verification

Status: done
Type: Task
Wave: 7 · Depends on: 08
Plan: [plan.md](plan.md)

Files:     none (a live run; screenshots go under the session scratchpad)
Consumes:  the `fake: visual` reply, its held streaming partial and the chat preview entries ← 07;
           the log lines `[visual] visual mounted: <title>` ← 05 and `[visual] visual frame loaded: <8 hex>` ← 04;
           the selectors `iframe.visual-frame-document` (inside `div.visual-frame`) ← 04 and `.visual-host` ← 05
Produces:  the live checks below, each with its screenshot path or query output in Proof
Decisions: live checks list only what the tests cannot see (`wigley:writing-tests` § What earns a live run instead).
           Checks only the user's eyes can settle go in the run's final reply, never in this document
           (`~/wigley-agents/AGENTS.md` § Checks for the user).

Run every check through the drive tool (`npm run drive`, `.agents/skills/drive/SKILL.md`). It starts the dev app on a
temp home with the fake harness. Start a chat with `do chat.start`. In the commands below, `<frames>` is the
selector `.session-body:not([hidden]) iframe.visual-frame-document`; its first match is the mockup and its second the
flowchart. Run the checks in this order, because check 1 decides how the rest are judged.

1. **Offscreen windows paint a cross-origin frame** — *low-confidence*: drive windows render offscreen, and nothing
   yet proves that paints an out-of-process frame. Type `fake: visual` and send it. Wait for two
   `[visual] visual frame loaded: ` lines. Take `screenshot visual-mockup` on the first `<frames>` match.
   - Pass: the mockup's content shows.
   - When the frame is blank: `query` the first `<frames>` match's computed height. A non-zero height and the two
     loaded lines mean the visuals work and only the capture is blank. Record that in Proof. Then judge checks 2 and
     4 by query and log as each says, and name "look at both visuals and a theme change in a real window" as a user
     check in the run's final reply.
2. **Both visuals draw whole, in the theme** — *expected*: screenshot the reply entry (`.visual-host` parents).
   - Pass: the mockup uses the theme's surfaces and text colours; the flowchart's nodes, arrows and labels read;
     neither frame shows a scrollbar or a clipped bottom edge.
   - Fallback when check 1 failed: `query` each `<frames>` match's height and its content's reported height are
     equal and non-zero (no cap); the colour half moves to the user check.
3. **The card while streaming, then each frame loads once** — *low-confidence*: reuse across streaming redraws has
   unit tests, but the real entry list and layout redraw path is wiring. Send `fake: visual` again. While 07's
   pinned hold keeps the second block open, take `screenshot visual-streaming` on the reply entry. After the final
   entry:
   - Pass: the streaming screenshot shows the first visual drawn and the `drawing visual…` card for the open block.
   - Pass: since the send, exactly two `[visual] visual mounted:` lines and two `[visual] visual frame loaded:` lines
     (a reload or remount adds more).
   - Pass: `query` the two new `<frames>` matches' `src` before and after a further `screenshot`; both are unchanged.
   - Pass: the layout preview (`Space z l c`) shows the `drawing visual…` card on its streaming entry
     (`screenshot visual-preview`).
4. **A theme change reaches a drawn visual** — *low-confidence*: the posted theme crosses the page, the frame and the
   config push. Change the theme through the drive home's settings (toggle reduced transparency), then
   `screenshot visual-theme` on the first `<frames>` match.
   - Pass: the drawn visual takes the new colours with no new `visual frame loaded` line.
   - Fallback when check 1 failed: only the "no new loaded line" half; the colours move to the user check.
5. **Overlay and keys** — *low-confidence*: wiring between chat's focused entry, the `v` bind and the overlay. Press
   `key Escape` (the box gives up focus; the latest entry is focused), then `key k` once (the reply entry), then
   `key v`, then `screenshot visual-overlay`; `key l`, `screenshot visual-overlay-next`; `key Escape`.
   - Pass: the log holds `visual overlay showing 1 of 2`, then `visual overlay showing 2 of 2`, then
     `visual overlay closed`; the two screenshots show the mockup, then the flowchart, at full window size.
6. **Esc hands focus back from inside a visual** — *low-confidence*: a click into an out-of-process frame. `query`
   which entry slot is focused (the class the entry list marks its focused slot with; read it from
   `src/plugins/chat/page/entry-list.ts`). Click the centre of the first `<frames>` match. Press `key Escape`, then
   `key j`.
   - Pass: the focused slot moved one entry down from the slot queried first, so the page has the keys again.
7. **Offline** — *expected*: the CSP header and the navigation rule have unit tests in 02; this checks that the
   browser enforces them. Send this message (type each line in insert mode, `key Enter` between lines):

   ~~~
   look
   ```html
   <!doctype html><html><body><p id="r">waiting</p><script>
   fetch('https://example.com').then(() => { r.textContent = 'fetched'; }, () => {
     r.style.display = 'block'; r.style.height = '400px'; r.textContent = 'blocked';
   });
   </script></body></html>
   ```
   ~~~

   The echo puts `look` after `fake agent heard: `, so the fence starts on its own line in the assistant entry.
   - Pass: the assistant entry's frame reports a height of at least 400 (`query` its height), so the fetch failed.
   - Then `query` the frame's `sandbox` attribute. Pass: exactly `allow-scripts`.
8. **Your own html stays code** — *expected*: the same send as check 7.
   - Pass: the user entry shows the block as code (no `.visual-host` inside the user entry); the assistant entry holds
     one `.visual-host`.
9. **Self-test** — *expected*: run `npm run selftest` whole; it takes no filter.
   - Pass: the run passes, its `visuals` group lines hold, the log holds `every key placed`, and
     `.selftest/screenshots/chat-visuals.png` exists.

Done when: checks 1–9 each have a pass, or a failure fixed and re-run, in Proof with their screenshots' paths; the
user checks (a real-agent run, and check 1's fallback when taken) are listed in the run's final reply.
Commit:    none (Proof and the Run log ride in the lead's next commit)

## Proof

Commit 8d2b7965 (check 2 fix) · proof: 1 PASS (window captures; element capture of an iframe fails UnknownVizError) · 2 FAIL then fixed in 8d2b7965: a scrollbar/height feedback loop on the width-scaled flowchart, re-run shows no strip (.drive/visuals-fix/screenshots/after-fix.png) · 3 PASS (2 mounted + 2 loaded lines, src unchanged, preview card) · 4 FALLBACK: no new loaded line; colours not visible offscreen → user check · 5 PASS (overlay 1 of 2, 2 of 2, closed) · 6 PASS low-confidence (slot 4→5; activeElement still the iframe) · 7 PASS (height 432, sandbox allow-scripts) · 8 PASS · 9 PASS (npm run selftest whole, every key placed, chat-visuals.png) · concerns: a visual wider than the column gets a horizontal scrollbar over its bottom ~15 px (reported height leaves it out); opening the preview or switching sessions reloads every frame; the preview's session-body stays un-hidden at width 0
