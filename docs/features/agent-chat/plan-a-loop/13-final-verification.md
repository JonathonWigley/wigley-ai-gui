# 13 — Final verification

Status: not started
Type: Task
Wave: 8 · Depends on: 12
Plan: [plan.md](plan.md)

Files:     none
Consumes:  the whole landed plan; `npm run selftest` green at the test gate
Produces:  the user's results for each live check below, recorded in this task's Proof
Decisions: a visible `npm start` takes the user's foreground and keyboard, so these checks are the user's
           (`AGENTS.md`, Running and testing): the agent hands the user the steps and records the answers · the
           checks are only those a test or the self-test cannot reach — the real `claude` process, the real relay,
           real forms rounds and real alerts (`wigley:writing-tests` § What earns a live run instead)
GIVEN the landed plan WHEN the user runs each check below in `npm start` THEN each passes, or its failure is
      recorded with what the user saw and becomes a fix group or a follow-up by the user's ruling
Tests:     the live checks, each tagged with why it is on the list:
           1. **Start a session** (expected) — `Space k n`, pick this repo's folder via "Choose folder…", pick
              `personal`. A row appears for the folder, selected, with a Chat tab and the box focused; no second row
              appears for the same session within ten seconds (the relay joining the owned row is wiring no test
              sees: low-confidence).
           2. **Chat** (expected) — type `Say hi in three words`, Enter in normal mode. The reply streams into one
              assistant entry; the row's status reads `working`, then clears.
           3. **Tool call** (expected) — send `Run ls in the project folder`. One compact line `Bash · ls` (or the
              task 06 summary) appears; `j`/`k` to it and `Enter` expands it to the input and the output.
           4. **Permission** (low-confidence: real Claude through the relay's tool) — send a message whose tool auto
              mode would still prompt for (e.g. `Write the text hi into /tmp/wigley-chat-check.txt`; if auto mode
              allows it, note that and try `Delete /tmp/wigley-chat-check.txt with rm`). A permission entry shows;
              `n`, a reason, submit: Claude reads the reason. Repeat and press `y`: the tool runs.
           5. **Form swap** (low-confidence: two plugins' wiring with a real round) — send
              `/wigley:feature add a hello command`. When the agent sends its first round, the session's tab switches
              to the Form tab by itself. Submit the round: the Chat tab shows again. On the next round, cancel it: the
              Chat tab shows again.
           6. **Round for another session** (expected) — with two app sessions, trigger a round in the one not on
              screen: the current session stays on screen, the other row is marked, and opening it shows its Form tab.
           7. **Controls** (low-confidence: control-protocol and slash-command changes on the real CLI) —
              `Space c e`, pick another effort; `Space c m`, pick `plan`; `Space c o`, pick another model. The status
              line shows each new value, and the next reply follows it (plan mode: Claude plans instead of editing).
           8. **Interrupt** (low-confidence: the real process) — send a long task, then `Ctrl+C`. The turn ends with
              a notice; a new message gets a reply in the same session.
           9. **Turn alert** (low-confidence: native alerts) — send a message, then switch to another app before the
              reply ends: a notification (or Dock bounce, unsigned build) arrives and the row is marked; clicking the
              notification brings the window and the session forward.
           10. **Close** (expected) — while a turn runs, `Cmd+W`: the confirm shows; `y` closes the row, and
               `ps -ax | grep "claude -p"` shows no process for that session.
           11. **Work profile** (low-confidence: the profile reaches the CLI) — start a session with `work`: its
               transcript appears under `~/.claude/projects/`, not `~/.claude-personal/projects/`.
           12. **Chat layout** (expected) — `Space z c c` copies the default chat layout; edit its `layout.js` in
               the app's data folder (`plugins/chat/layouts/default-2/`) to change the assistant entry's class, save:
               the open chat redraws with the change and keeps its entries.
Done when: every check has the user's result recorded in Proof; every failure has the user's ruling
Commit:    none — the results go in this document's Proof with the run's closing commit

## Proof
