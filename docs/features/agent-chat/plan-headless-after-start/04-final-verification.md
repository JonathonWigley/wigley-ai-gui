# 04 — Final verification

Status: done
Type: Task
Wave: 3 · Depends on: 03
Plan: [plan.md](plan.md)

Risk: Medium — UI wiring in the start prompt and a new MCP tool across chat's tool contribution and its flag.

Checks:

1. `npm run lint` and `npm test` filtered to the files 01 and 02 touched (`resume-items`, `start-prompt`,
   `chat-sessions`, `set-headless-tool`, chat `start`).
2. `npm run selftest -- --plugin chat`, plus `--plugin <id>` for each other script 01 changed — expected path:
   the archive steps and the `Ctrl+n` start run green. Whole self-test runs only on the user's ask.
3. Drive run (`.agents/skills/drive/SKILL.md`), low-confidence path: open `Ctrl+n` in a folder, pick the profile,
   and confirm the session starts with no Session picker; then `Space b n` on a folder with saved sessions shows
   New session with no New headless session line. Capture a screenshot of each and read it.

Not checked live: an agent calling `set_headless` in a real Claude session — the tool test and the wiring test in
02 pin it, and the fake harness cannot call MCP tools. The user's own first use covers it after the install.

Done when: every check above passes or its failure is fixed

## Proof

Commit 1d41e31d · proof: lint, tsc, picked tests, selftest --plugin chat all passed; drive run headless-check: Ctrl+n starts with no Session picker, Space b n lists New session + two saved rows, screenshots read · concerns: none
