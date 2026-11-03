# 04 — Doc re-read

Status: done
Type: Task
Wave: 4 · Depends on: 03
Plan: [plan.md](plan.md)

Files:     modify (where stale) `docs/features/agent-chat/design.md` · `docs/keymap.md`
Decisions:
- Read `docs/features/agent-chat/design.md` § Pending messages line by line against the landed code: the intro, Sending, Send now, Pulling back, Interrupt and exit. § Send now was written ahead with `<Leader>cs`, which round 3 dropped: rewrite it to the landed routes (Cmd+Enter on a focused pending row sends that row; Cmd+Enter in the box sends the box and every unsent pending message in written order while busy, and as Enter while idle). Also read the `queuedMessage` part line in its layout section, which was updated ahead to name `sent`. Check every log line, label, key, field name (`sentEntryId`, `messageDropped`) and behaviour, and fix each line that drifted.
- `docs/keymap.md`: remove `cs` from the `c` leader row (round 3), and check the Cmd line still holds (Cmd+Enter is a send). Session ai-dev-2e edits the Cmd line for Enter/Shift+Enter; keep its wording.
- `AGENTS.md`: nothing expected. Confirm with `grep -n "AgentProcess\|queuedMessage\|user entr" AGENTS.md` that no line describes send timing.
Done when: each doc matches the code; fixes committed.
Commit:    one commit, or none when nothing was stale

## Proof

Commit fff51890 · proof: diff read: Send now, Interrupt and exit, Chat tab lines match chat-commands/chat-sessions; keymap.md cs removed, oxfmt --check clean after lead ran the repo formatter (tooling-only) · concerns: design.md ~:80 flow diagram still reads 'Enter (normal) / Cmd+Enter' (the Enter session's area); sendNow on a sent row logs 'no longer queued' while pullBack logs 'already sent'; § Chat tab still says Ctrl+C pulls back every pending message (only unsent now)
