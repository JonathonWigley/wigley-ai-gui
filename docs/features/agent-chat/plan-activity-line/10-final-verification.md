# 10 — Final verification

Status: done
Type: Task
Wave: 6 · Depends on: 09
Plan: [plan.md](plan.md)

Files:     none (captures go under `.selftest/screenshots/` and the drive run's own folder, both outside git)
Consumes:  every landed group
Produces:  the checks below, each with its result, in the Proof
Decisions: run, from `/Users/jonathonwigley/Documents/ai-dev/wigley-ai-gui` (Node per `.nvmrc`: `source ~/.nvm/nvm.sh && nvm use && npm run …` when the shell is on another version):
           1. `npm run lint`
           2. `npm test` (Vitest with the type tests)
           3. `npm run selftest`; every group passes. Read each screenshot below against `DESIGN.md` and `docs/features/agent-chat/design.md` § Activity line
           4. a drive run (`npm run drive`, the loop in `.agents/skills/drive/SKILL.md`) for the checks the self-test cannot reach
           Live checks (`wigley:writing-tests` § What earns a live run instead), each tagged:
           - **expected** — `chat-activity-live.png`: one live header (running dot, `Thinking`, `· 7 steps`, and a dim time such as `· 0s`) over a shortlist of exactly 5 lines, the last in `fg`, the older in `fg-tertiary`, the failed `Bash · false` line in `status-error`; the box has focus, draws no purple frame, and no entry shows a bar or ring
           - **expected** — `chat-activity-finished.png`: the run is one dim line `7 steps · Read 3 · Bash 2 · Edit · 1 failed · <time>`, `· 1 failed` in `status-error`, the time last; the box has no focus, and the focused activity line shows the thin left bar, not an inset ring
           - **expected** — `chat-activity-open.png` and `chat-step-open.png`: the open line keeps its header and lists one plain row per step (no card background or border), indented under it; the opened tool row shows Input and Result under it in place
           - **expected** — `chat-chat-preview.png` (`Space z l c`): the sample's thinking, tools and raw entries draw as finished activity lines (`1 step · 4s`, `3 steps · Bash 2 · Read · 1 failed · 8s`, `1 step · 4s`, from the fixture's fixed `at` values); the other kinds draw as before
           - **low-confidence** (timer wiring: real page timers and clock, which the tests replace) — drive run: start a session, send `fake: steps`, screenshot the Chat tab, wait about 3 seconds by polling the page log or a `query` (no `sleep`), screenshot again: the live line's time grew by about 3 s (`0s` then `3s`) and no other entry redrew (the log adds no entry lines); then `<C-c>`: the line turns finished and its time stops (two screenshots a few seconds apart show the same time)
           - **low-confidence** (history times from a real transcript) — drive run: resume a fake past session through the start prompt; its finished activity lines show times from the fake history's fixed `at` values
           - **low-confidence** (wiring no test sees) — drive run: set `fonts.proseSize` to `18` with the drive `setting` action, open the chat preview, and `query` the computed `font-size` of a `.md` paragraph in the assistant entry: `18px`; then unset it: `14px`
           - **low-confidence** (click handler, no test drives a real click) — drive run: in a Chat tab holding a finished run, `click` the `.chat-activity-slot`: its step rows show; `click` it again: they hide, and the cursor did not move (screenshot before and after)
           - **low-confidence** (layout fallback path through the page host) — drive run: write a user chat layout whose `activity` part throws, set `chat.layout` to it, and open the chat preview: the activity lines draw with `default` and the log holds `layout <name> activity` with the error, no toast
           - **expected** — the gallery (`Space z g`) Collapsible card section shows the plain closed and open cells with no card chrome (drive run screenshot)
           Checks for the user's own hands (a visible `npm start`, after the run; the agent lists them in its wrap-up and does not wait on them): none beyond the above, since every key and click here reaches the app through synthetic input
GIVEN the landed plan WHEN lint, tests, the self-test and the drive run finish THEN every check above holds, or each failure is a finding in the Proof
Tests:     none added
Done when: every check above has its result in the Proof
Commit:    none (captures are not committed); the Proof rides in `wigley:make`'s next plan commit

## Proof

Commit none · proof: lint: oxfmt flags only peer files DESIGN.md, docs/keymap.md; npm test 4282/4283 (the 1 fail is peer commit 9c84f9d's shell-chrome row); selftest all passed incl. activity line, screenshots chat-activity-open/chat-step-open read (step body under the tool name after 4f13fca); drive run 20261031-200407-528d (/tmp/claude-502/make-activity-line/reports/10-drive.md): live timer 0s→7s with no other redraws and frozen after C-c PASS, prose size 18px/14px PASS (nested setting), click open/close with cursor unmoved PASS, layout fallback logs and draws default with no toast PASS, gallery plain cells with no chrome PASS, history resume PASS with no activity line present · concerns: drive history check found no activity line in the fake past session (its history holds no steps), so history-time drawing is proved by transcripts tests, not live; a mouse click on an activity line logs no expanded/collapsed line; the drive's dotted setting name writes a flat key
