# 09 — Final verification

Status: done
Type: Task
Wave: 8 · Depends on: 08
Plan: [plan.md](plan.md)

Files:     none
Consumes:  the whole landed plan; `npm run selftest` green at the test gate (task 07's 34 chat steps)
Produces:  the user's results for each live check below, recorded in this task's Proof
Decisions: a visible `npm start` takes the user's foreground and keyboard, so these checks are the user's
           (`AGENTS.md`, Running and testing): the agent hands the user the steps and records the answers · only what a
           test or the self-test cannot reach is listed — real transcripts on disk, the real `claude --resume`, the
           popup's look and keys inside vim on a real keyboard (`wigley:writing-tests` § What earns a live run
           instead); the archive toggle, the cursor rules and the fake's resume are pinned by task 05's tests and task
           07's steps and stay off the list
GIVEN the landed plan WHEN the user runs each check below in `npm start` THEN each passes, or its failure is recorded
      with what the user saw and becomes a fix group or a follow-up by the user's ruling
Tests:     the live checks, each tagged with why it is on the list:
           1. **Saved sessions listed** (low-confidence: the transcript format and folder naming were measured at plan
              time on Claude Code 2.1.304 and are undocumented) — `Space k n`, pick this repo's folder, pick
              `personal`. The `Session` step lists `New session`, then this repo's terminal sessions newest first, each
              titled by its first message (a slash-command session as `/<command> <args>`) and its time; the session
              of the terminal the user runs right now (connected through the relay) is not in the list. Compare
              with `command ls -t ~/.claude-personal/projects/-Users-jonathonwigley-Documents-dev-wigley-ai-gui/`.
           2. **Resume with history** (low-confidence: the real `--resume` and a real transcript's entries) — pick a
              closed terminal session from check 1. Its Chat tab shows the earlier conversation: user messages,
              replies, tool calls that expand to their input and output, and no `raw` entry for an ordinary line.
              Send `What did we last talk about?`: the reply knows the earlier conversation. Then
              `command ls -t ~/.claude-personal/projects/-Users-jonathonwigley-Documents-dev-wigley-ai-gui/ | head -1`
              names that session's id (Claude kept writing the same transcript, not a fork; if a new id appears,
              record it: the list would show the fork too).
           3. **An app session in the list** (low-confidence: a transcript the app's stream-json session writes was not
              measured at plan time) — start a new session from the app, send `Say hi`, end it (`Cmd+W`), then
              `Space k n` with the same folder and profile: it is listed at the top, titled `Say hi`.
           4. **Work profile** (low-confidence: the profile's folder) — the same with `work`: only sessions under
              `~/.claude/projects/` show.
           5. **Archive survives a restart** (expected) — archive one entry with `x`, quit and `npm start` again: the
              entry is still hidden, `.` shows it marked `archived`, and `x` restores it; its `.jsonl` file under
              `projects/` is unchanged (`ls -l` before and after shows the same size and time).
           6. **Slash completion** (low-confidence: the popup inside vim, on the real keyboard, in the app's theme) —
              in a session that has already had one turn (send `Say hi` first when `claude-stream.md § Init` records
              init arriving only at the first message), in a Chat tab's box, `i`, type `/mo`: a popup under the box offers `/model` in the app's colours.
              `Ctrl+n` / `Ctrl+p` move, `Tab` accepts (`/model ` in the box), and `Escape` leaves insert mode with the
              popup closed. Type `/` after other text: no popup. Type `/` then `Enter` in insert mode: a new line, no
              accept. Accept `/compact`, `Escape`, `Enter`: Claude compacts, as in the terminal.
           7. **Forms boxes unchanged** (low-confidence: the shared editor host changed) — on the preview round
              (`Space z l o`), type `/` at the start of an answer box: no popup.
Done when: every check has the user's result recorded in Proof; every failure has the user's ruling
Commit:    none — the results go in this document's Proof with the run's closing commit

## Proof

All seven live checks passed in `npm start` (user, 2026-10-21), run at 78002bf: saved sessions listed, resume with history, an app session in the list, work profile, archive survives a restart, slash completion, forms boxes unchanged.
