# 06 — Final verification

Status: not started
Type: Task
Wave: 6 · Depends on: 05
Plan: [plan.md](plan.md)

Files:     none
Consumes:  01–05 landed
Produces:  the live checks below, run through the app's drive run against a real Claude session (AGENTS.md § Running and testing), each with its evidence: a still or the drive log
Decisions: only checks no unit test or self-test step already pins (writing-tests § What earns a live run instead):
           1. expected — the built-in pending row's look under the default theme: dim, labelled, wrapped, the cursor bar on it when focused, and clear of the floating composer at the list's bottom. A still with one short and one multi-line pending message
           2. low-confidence — real Claude drain: send a long task, queue `Reply with the single word two.` mid-turn; the first turn's result lands, then the queued message's user entry, then its reply, in that order in the transcript; the row shows `working` throughout and the sidebar's turn-finished mark comes once, after `two` (Claude's `result` timing is measured, the app's drain over it is not)
           3. low-confidence — real Claude Ctrl+C with one message queued: the box gets the message back, and the message never runs (no `two` reply follows the interrupted turn)
           4. low-confidence — a chat layout reload (save the user layout file) with a pending row showing: the row redraws and keeps its place after the entries
           5. low-confidence — a page reload (the dev server's reload) with a pending row showing: the row comes back from `sessions`
           Checks only the user's hands settle: none; a click on a pending row is driven like the other chat clicks
Done when: every check above passes with its evidence recorded in Proof, or a failure is reported with its evidence
Commit:    none

## Proof
