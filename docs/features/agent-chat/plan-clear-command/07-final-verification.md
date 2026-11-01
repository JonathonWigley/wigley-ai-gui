# 07 — Final verification

Status: not started
Type: Task
Wave: 4 · Depends on: 06
Plan: [plan.md](plan.md)

Files:     none (captures go under `.selftest/screenshots/` and the drive run's own folder, both outside git)
Consumes:  every landed group
Produces:  the checks below, each with its result, in the Proof
Decisions: run, from `/Users/jonathonwigley/Documents/ai-dev/wigley-ai-gui` (Node per `.nvmrc`: `source ~/.nvm/nvm.sh && nvm use && npm run …` when the shell is on another version):
           1. `npm run lint`
           2. `npm test`
           3. `npm run selftest`; every group passes
           4. a drive run (`npm run drive`, the loop in `.agents/skills/drive/SKILL.md`) with the real Claude harness (`start --harness claude`, the drive skill's § Real Claude), for the checks the self-test cannot reach. Use the cheapest model (`haiku`) and one-word prompts.
           Live checks (`wigley:writing-tests` § What earns a live run instead), each tagged:
           - **expected** — the self-test `clear` group's screenshot (`chat-second`): the Chat tab holds exactly one info notice, `Conversation cleared`, and the composer is empty
           - **low-confidence** (process restart wiring, no test runs a real `claude`) — drive run: start a session, send `Reply with the single word ok.`, then `/clear`. The log shows a new process started (`process started (resume false)`) and `conversation cleared in <folder>`, and the tab shows only the notice, with no "Claude stopped" exit notice; a following `Reply with the single word ok.` gets `ok`
           - **low-confidence** (control values reach the launch) — drive run: set the Model control to `sonnet` before `/clear`; right after it, before any reply, the Model chip reads Sonnet, and the next reply's assistant entry `raw` names a Sonnet model           - **low-confidence** (relay join on the new id) — drive run: after `/clear`, the log shows `relay joined session <app id>` or `newer relay took over session <app id>` (either, by timing) for the cleared row's app id, and the sidebar gains no second row for the folder
           - **low-confidence** (saved record and resume) — drive run: after a post-clear reply, close the row and open the resume list for the folder: it lists the post-clear session (title `Reply with the single word ok.`) and the pre-clear one as separate entries; resuming the post-clear one shows only what came after the clear
           - **low-confidence** (docs source follows the id) — drive run: after `/clear` and one reply, the docs log shows the session index run with the new host id, not the old one
           Checks for the user's own hands (listed in the wrap-up, not waited on): none — every key reaches the app through synthetic input
GIVEN the landed plan WHEN lint, tests, the self-test and the drive run finish THEN every check above holds, or each failure is a finding in the Proof
Tests:     none added
Done when: every check above has its result in the Proof
Commit:    none (captures are not committed); the Proof rides in `wigley:make`'s next plan commit

## Proof

