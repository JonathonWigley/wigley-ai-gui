# 08 — Final verification

Status: done
Type: Task
Wave: 6 · Depends on: 07
Plan: [plan.md](plan.md)

Files:     none (captures under the drive run's folder)
Consumes:  the landed app
Produces:  a drive run report: each check below passed or failed, with its screenshot path
Decisions: live checks only where no test can see the claim (`wigley:writing-tests` § What earns a live run instead)
Done when: every check below ran in a drive run under the fake harness and its result is reported
Commit:    none

## Setup

Load the `drive` skill (`.agents/skills/drive/SKILL.md`) and launch a drive run with the fake harness. No step
touches the user's own app, config or Claude profiles: the drive run has its own home.

## Checks

1. **Completion popup unclipped** — expected path, the reported bug. Start a session (`chat.start`), focus the box,
   type `/`, screenshot. The popup shows every offered word above or beside the composer, nothing cut at the
   composer's edge; `query` the popup's box against the composer's box. Also check that the popup takes the editor
   theme (background, row height) rather than CodeMirror's defaults.
2. **Folder step lists harness folders** — low-confidence: new wiring across main and page. After check 1's session
   started in `<home>/dev/drive-project`, delete `<run>/home/plugin-data/chat/recent-folders.json` (drive-run debug
   state; list the deletion in the report), so the folder can only come from the fake's `listProjects`. Open the
   start prompt (`Space k n`): that folder is listed, and `Choose folder…` is last.
3. **Sign-in from the start prompt** — expected path. In check 1's session (profile `work`, `chat.start`'s default) send `/logout`: a notice
   `Signed out of work` shows. Open the start prompt, pick the folder, Enter on the Profile step (`work` pre-selected): the sign-in
   dialog opens showing `https://example.invalid/fake-sign-in`; `i`, type `wrong`, Cmd+Enter → the dialog closes with
   a `Sign-in failed` toast. Repeat with `fake-code` → toast `Signed in to work as fake@example.invalid` and the session
   step opens.
   Open it once more and press Esc → it closes, nothing starts.
4. **`/status` and completion of app commands** — low-confidence: the registry joins the completion list. Type `/st`
   in the box: `status` is offered. Send `/status`: a notice `<profile>: signed in as fake@example.invalid`. Reload
   the page (drive reload): the notice is still in the chat.
5. **Attached images** — expected path; also proves the CSP lets `data:` images draw. Through `eval`, dispatch a `paste` event on the composer whose
   `clipboardData` holds a generated 16×16 PNG `File`, and a `drop` event holding a second one: two thumbnails show
   above the box. Click one's remove button → one left. Dispatch a paste holding a `text/plain` file → the refusal
   toast. Send with text `hi`: the user entry shows the text and one thumbnail; the strip is empty.
6. **Image viewer** — expected path. Click the sent thumbnail → the viewer shows it fitted, screenshot; Esc closes.
   Focus the entry (`k`) and press Enter → the viewer opens again.
7. **Composer height with the strip** — low-confidence: layout. With three attached images, the last chat entry
   stays fully above the composer (screenshot the bottom of the entries).

Report each check's result and screenshot path. A failed check is reported with what showed, not fixed in this task.

## Proof

Drive run chk081 (fake harness), report /private/tmp/claude-502/-Users-jonathonwigley-Documents-dev-wigley-ai-gui/19451c96-28e0-469f-b152-0c5a1c764c3b/scratchpad/reports/08-1.md, screenshots under /screenshots/. All seven checks passed:
1. popup unclipped, mounted on body, themed (c1-popup.png); it draws below the cursor over the composer, fully visible.
2. folder step lists `~/dev/drive-project` from listProjects, `Choose folder…` last (c2-folders.png); low confidence, an in-memory recent list not ruled out.
3. /logout notice, sign-in dialog, wrong code toast, fake-code signs in and opens the session step; Esc closes on the second press (first leaves vim insert) (c3-*.png).
4. `/st` offers `/status`; its notice survives a reload (c4-*.png).
5. paste and drop thumbnails draw (CSP allows data:), remove, text/plain refusal toast, send shows text and one thumbnail (c5-*.png). Anomaly: one first send lost the text `hi` around a hot reload from the peer's edits; not reproduced.
6. viewer fits the image, Esc closes, Enter on the user entry reopens it (c6-*.png).
7. last entry stays above the composer with three images (c7-*.png).
Debug state deleted: /home/plugin-data/chat/recent-folders.json.
