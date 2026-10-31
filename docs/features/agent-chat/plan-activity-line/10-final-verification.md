# 10 — Final verification

Status: not started
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
           - **expected** — `chat-activity-live.png`: one live header (running dot, `Thinking`, `· 7 steps`) over a shortlist of exactly 5 lines, the last in `fg`, the older in `fg-tertiary`, the failed `Bash · false` line in `status-error`; the box has focus, draws no purple frame, and no entry shows a bar or ring
           - **expected** — `chat-activity-finished.png`: the run is one dim line `7 steps · Read 3 · Bash 2 · Edit · 1 failed`, `· 1 failed` in `status-error`; the box has no focus, and the focused activity line shows the thin left bar, not an inset ring
           - **expected** — `chat-activity-open.png` and `chat-step-open.png`: the open line keeps its header and lists one plain row per step (no card background or border), indented under it; the opened tool row shows Input and Result under it in place
           - **expected** — `chat-chat-preview.png` (`Space z l c`): the sample's thinking, tools and raw entries draw as finished activity lines (`1 step`, `3 steps · Bash 2 · Read · 1 failed`, `1 step`); the other kinds draw as before
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

