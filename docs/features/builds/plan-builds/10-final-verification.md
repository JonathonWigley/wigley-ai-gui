# 10 — Final verification

Status: not started
Type: Task
Wave: 5 · Depends on: 09 (it checks the tree after the doc re-read)
Plan: [plan.md](plan.md)

`wigley:make` runs this task once, in its live session, after its test gate. Each check runs in a
drive run of the app (the app's `drive` skill: `npm run drive -- start`, `setting`, `key`,
`screenshot`, `quit`), on a fresh temp home. Read each screenshot against `DESIGN.md`.

## Setup

- Make a scratch git repo under the session scratchpad with `git init -b main`, and make one
  commit in it. This is the local game's clone. It has no remote: the local backend picks no
  branch (`choosesBranch` false) and reads no origin.
- Write a build script `ok` in the scratchpad. It prints a line every 10 s for about 40 s, then
  exits 0. Write a second script `bad`. It runs for about 25 s, then exits 3. The poller polls
  every 10 s, so each build is seen running for more than one poll.
- `npm run drive -- setting builds.backends '<json>'` with one `local` backend `{"id":"home",
  "kind":"local","label":"Local","config":{},"games":[…]}` whose one game `demo` names the scratch
  clone, `defaultBranch` `main`, kinds `ok` (the exit-0 script) and `bad` (the exit-3 script), and
  one set `both` over `["ok","bad"]` with `branches` `releases/demo/*` and no `agentPrompt`.
  The `branches` value is inert for a local game: nothing reads it.
- A TeamCity backend is not driven: a drive run must not reach the real server, and a queue
  spends shared machines. Its parsers are proved by task 04's tests over recorded JSON.

## Checks

1. **Expected** — `Space k m` opens Builds mode. The side bar shows All, then `Local` with `demo`
   under it. Screenshot.
2. **Expected** — on `demo`, the queue button for `ok` queues a build. The row shows `main`, the
   short revision and the commit subject of the scratch commit, a running state, and then
   success with the progress bar gone. Screenshot while it runs and after.
3. **Low-confidence** (local progress is elapsed over the last success; no test covers the drawn
   bar) — a second `ok` build shows a progress bar that moves and a time left. Take two
   screenshots about 10 s apart (one poll). After each, read the running row's meter with
   `npm run drive -- query -- '<the row's selector> .ui-meter' --ui-meter-percent`. The second
   `--ui-meter-percent` is larger than the first.
4. **Expected** — `Space m q` opens the queue picker on `demo`. It lists `Kinds` (`ok`, `bad`)
   and `Sets` (`both`). Picking `both` queues two builds at once, with no branch step. The list
   shows them grouped as one set run (one set group). Branch picking is not driven here: 06's
   `start.test.ts` rows (`'queues $choice'`, with `choosesBranch` true) prove it.
5. **Low-confidence** (chat `send` from main into a fake session; wiring no unit test reaches) —
   start a fake chat session with `chat.start`. Keep its `sessionId` (not its `hostSessionId`).
   Run `npm run drive -- do agent-commands.call '{"sessionId":"<sessionId>","tool":"run_command","args":{"command":"builds.queue","arg":{"backend":"home","game":"demo","kind":"bad","branch":"main"}}}'`.
   It returns `{ callId }`. `builds.queue` is risky, so the call waits on an Allow or Deny round
   in that session's form. Forms' drive actions (`forms.openRound`, `forms.answers`) only open
   and read rounds, so answer it with keys: `key 1` picks Allow (`forms.choose` 1),
   `key Space Space` opens the review (`forms.openReview`), and `key <D-Enter>` submits
   (`forms.submit`). Then `do agent-commands.result '{"callId":"<callId>"}'` gives a result
   that is not `{ pending: true }` and holds no error. The session row shows the build line, the activity word `building` while it
   runs, and the hub's Builds section lists it. When it ends, the session's transcript holds one
   message that opens `Build ended:` and names `Failed:`. Screenshot the row, the hub and the
   transcript.
6. **Low-confidence** (offer state survives a restart; persistence crosses main and page) — from
   the same session run `do agent-commands.call '{"sessionId":"<sessionId>","tool":"run_command","args":{"command":"builds.offer","arg":{"backend":"home","game":"demo","kind":"ok","branch":"main"}}}'`,
   and read its result with `do agent-commands.result '{"callId":"<callId>"}'`. The offer card
   shows. `restart`. The
   card still shows. `Space m m` queues it and the card goes. Run a second offer, then
   `Space m x` dismisses it.
7. **Expected** — queue an `ok` build. While it runs, `x` on its row in Builds mode cancels it;
   the row ends as cancelled.
8. **Low-confidence** (problem display for a bad entry) — `setting builds.backends` with a
   `local` game that has no `clone`. The backend's heading in the side bar shows the problem
   text.

9. **Low-confidence** (chip state and click wiring are drawn by the layout) — on All, the chips
   All, Running and From sessions filter the feed in place, and the chosen chip shows as chosen.
10. **Low-confidence** (the in-list detail is a new pattern in this app) — `Enter` on a row opens
    its detail under the row: each job with progress and step text, the links, and Open in the
    backend. `o` opens the backend page (check the main log line; launch no browser).
11. **Expected** — the hub's Builds section lists the session's builds newest first, between Live
    and Skills, and is hidden in a session with no builds.
12. **Low-confidence** (two composer stops: the agent strip's and the offer card's) — with an offer
    shown, `j` from the last transcript entry reaches the offer card's stop, with and without
    agent-strip boxes: the offer card's stop comes first (07 Decisions, two composer stops).
    `Enter` there queues and `x` dismisses; after either the cursor goes back to the entries.
    With agent-strip boxes, after the queue or dismiss, `j` from the last entry reaches the
    agent strip's stop again.
13. **Expected** — the demo steps `builds.mode` and `builds.session` show their samples, and
    `npm run selftest -- --plugin demo` passes its coverage check for the three plugins.
14. **Expected** — the poll cadence follows the mode. Read `builds.snapshot`'s `polledAt` twice
    with `do agent-commands.call '{"sessionId":"<sessionId>","tool":"read_state","args":{"slot":"builds.snapshot"}}'`
    and `do agent-commands.result '{"callId":"<callId>"}'`, and compare the two values. While
    Builds mode shows, the gap is about 10 s. After the mode hides, with no linked build running,
    the gap is about 2 minutes.
15. **Expected** — `npm run selftest -- --plugin builds` passes. The builds self-test covers the
    main part over its fixture backend.

## Dropped

- The message texts, the poll cadence, the 14-day pruning, set summaries and the failing message
  are pinned by task 02's and task 03's tests; the checks above prove only their wiring.
- TeamCity record parsing, the revision, percent and links are pinned by task 04's tests.

## Not checked

- A real TeamCity queue and its finish message: it needs the user's ask, since it spends shared
  build machines. Named in the wrap-up's `Not checked:` line.

## Proof
