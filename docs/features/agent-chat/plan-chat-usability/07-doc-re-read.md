# 07 — Doc re-read

Status: done
Type: Task
Wave: 5 · Depends on: 02, 06
Plan: [plan.md](plan.md)

Files:     modify (only where stale) `docs/features/agent-chat/design.md` · `docs/features/agent-chat/claude-stream.md` ·
           `docs/keymap.md` · `AGENTS.md` · `docs/features/followups.md`
Consumes:  the landed code of tasks 01–06
Produces:  each doc written ahead (commit `3a0e6c2`) true to the landed code
Decisions: a doc written before its code is a hypothesis (`wigley:writing-for-agents` § Doctrine before code)
Done when: every line of the five docs' plan C changes (`git show 3a0e6c2`) checked against the code; every stale
           line fixed; lint passes; the fixes committed
Commit:    one commit, or none when nothing is stale

## Check

Read `git show 3a0e6c2` line by line. For each claim, find the code that makes it true: names (`addSlashCommand`,
`accountStatus`, `logIn`, `logOut`, `listProjects`, `tempFolders`, `images()`), copy (`Finish sign-in in your
browser`, `Signed in to <profile> as <account>`, the `/status` notice), the 5 MB rule (the code reads it on the base64
length), the keys (`<Leader>cx`, `h` / `l` / Esc in the viewer, Cmd+Enter / Esc in the sign-in dialog), the transcript
companion line's handling, and the folder step's order and filters. Fix the doc, not the code, unless the code
contradicts a decision in `plan.md` — that goes in the report instead. Run `wigley:writing-for-agents` on each fix.

## Proof

Committed with its Proof (see git log) · diff read · lint passes · fixed AGENTS.md claude-code line and kit list; design.md folder cap, sign-in keys and copy, ended-session toasts, 5 MB base64 wording · keymap.md, claude-stream.md, followups.md true as written · concerns: none new
