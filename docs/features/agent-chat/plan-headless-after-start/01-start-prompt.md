# 01 — Start prompt drops the headless line and skips a one-line session step

Status: not started
Type: Batch
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/page/resume-items.ts` · modify `src/plugins/chat/page/start-prompt.ts` ·
           modify `src/plugins/chat/contract.ts` · modify `src/plugins/chat/main/chat-sessions.ts` ·
           modify `src/plugins/chat/main/selftest-script.ts` ·
           test `src/plugins/chat/page/resume-items.test.ts` · test `src/plugins/chat/page/start-prompt.test.ts` ·
           test `src/plugins/chat/main/chat-sessions.test.ts`
Consumes:  nothing
Produces:  `SessionItem`'s new line becomes `{ kind: 'new'; label: string }` in `resume-items.ts`
           `export type StartRequest = StartTarget & { profile: string }` in `contract.ts`
Decisions: headless is set only after start (user's ask) · a step whose lines are exactly the one New session
           line is skipped, every caller (round 1 Q3, widened by Decided notice) · resume keeps its headless flag

Items:

1. **resume-items.ts** — delete `NEW_HEADLESS_SESSION_LABEL` and the headless line in `sessionItems`; the `new`
   variant loses `headless`. `newSessionIndex` finds the one `new` line; `isSameLine` treats two `new` lines as the
   same line. Rewrite the doc comments that name "the new-headless-session line" or "both new-session lines".
2. **start-prompt.ts** — `startSession` takes no `headless` and sends `start` with `{ ...target, profile }`.
   `openSessionStepOn` starts the session at once (through `startSession`, with `step = null`) when the items are
   exactly one `new` line, and opens the picker otherwise; this one rule covers `Ctrl+n` (`openForNewSession`, rows
   `[]`), a target with no saved sessions, and a listing that failed (its toast still shows first). The header
   comment over `StartPrompt` and `listSessions`'s comment stop naming a new headless session and "the two
   new-session lines"; `toggleArchive`'s `cannot be archived` log keeps working for the one line.
3. **contract.ts / chat-sessions.ts** — drop `headless` from `StartRequest` and its comment; chat-sessions' `start`
   opens with `headless: false`. A `chat-sessions.test.ts` case that starts a row headless through `start` moves to
   `start` then `setHeadless(id, true)`, or to `launch` with `headless: true`, whichever its rule is about.
4. **selftest-script.ts** — `ARCHIVE_STEPS`' first step presses `['j', 'x']`, its `why` saying the step opens on New
   session with the saved session below it. Grep every plugin's `selftest-script.ts` for steps that reach the
   Session picker (`picker shown: Session`) through `Ctrl+n` or a target with no saved sessions, and change each to
   expect the session's start line instead. When no chat self-test step runs `Ctrl+n` to a started session, add one
   to an existing group whose fixture already has a profile picked by the prompt.

GIVEN `Ctrl+n` and a picked profile WHEN the prompt reaches the session step THEN `start` is invoked once with no
`headless` field and no Session picker opens
GIVEN `Space b n` on a folder with saved sessions WHEN the session step opens THEN its lines are New session then
the rows, cursor on New session
GIVEN a target whose saved-session listing rejects WHEN the step would open THEN the toast shows and the session
starts at once
GIVEN a resume-section row that was headless WHEN it is picked THEN `resume` carries `headless: true` (unchanged)

Tests:     `resume-items.test.ts` — the `sessionItems` table drops the headless row and its `given: 'the new
           headless session line'` case; `start-prompt.test.ts` — `openForNewSession_savedSessions_SessionStepHoldsTheNewLinesAlone`,
           `pastSessionsRejects_opensNewSessionAloneAndToasts`, `projectPastSessionsEmpty_SessionStepHoldsTheNewLinesAlone`
           and `openForNewSession_Project_SessionStepHoldsTheNewLinesAlone` become the "starts at once" rule (rename
           each to the behaviour it now pins; fold into one table where they share the rule); delete
           `toggleArchive_newHeadlessSessionLine_writesNothing`; every fixture item `{ kind: 'new', …, headless }`
           drops the field
Done when: `npm run lint` and the touched test files pass; the compiler finds no `headless` on a `new` item
Commit:    one commit for the group

## Proof
