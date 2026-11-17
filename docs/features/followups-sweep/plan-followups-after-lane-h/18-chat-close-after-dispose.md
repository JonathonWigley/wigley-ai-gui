# 18 — Chat close after dispose

Status: not started
Type: Task
Rung: hard · a disposed flag changes how two async exports behave across the part's stop
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Follow-up: **Chat's `close` and `closeSessionsIn` never resolve after dispose** (`followups.md` L772).

Files:     modify `src/plugins/chat/main/start.ts` · test `src/plugins/chat/main/start.test.ts`

Preconditions (Lane H tree, 2026-11-17; re-run on merged `main` from the `wigley-ai-gui/` folder):
- `grep -n "endWaits.set(sessionId, resolve)" src/plugins/chat/main/start.ts` → two lines, in `closeSessionsIn` and
  `close` of `exports`.
- `grep -n -A3 "for (const resolveWait of endWaits.values())" src/plugins/chat/main/start.ts` → in the part's
  `dispose`, followed by `endWaits.clear();`: waits set later resolve never.
- `grep -n "const requireHeld = " src/plugins/chat/main/start.ts` → one line.
- `grep -n "'exports_\$method_SessionChatDoesNotHold_Rejects (\$target)'" src/plugins/chat/main/start.test.ts` → one
  line (the title this task also renames; task 13's rule).
- The scheduled-tasks plan (tasks 09, 14) edits this file's contributions and adds `prepareLaunch`, `adopt`,
  `projects` and `onInstructionsChanged` exports; it does not touch `close`, `closeSessionsIn`, `endWaits` or
  `dispose`. Write against the merged file.

Consumes: nothing from another task.

Produces: no new export. `ChatMainExports.close` and `closeSessionsIn` reject once the part is disposed.

Decisions:
- **A disposed flag.** `let isDisposed = false;` beside `endWaits`; `dispose` sets it first, before `detachAll`.
  A helper beside `requireHeld`: `const requireRunning = (call: string) => { if (isDisposed) throw new Error(`chat is
  stopped; ${call} refused`); };`. `close` calls `requireRunning('close')` before `requireHeld`; `closeSessionsIn`
  calls `requireRunning('closeSessionsIn')` first. Both are `async`, so the throw is a rejection, as `requireHeld`'s
  is.
- **Only the two waits.** The item names the two calls that set an `endWaits` entry. Other exports keep their own
  behaviour after dispose (`send` and `clear` already fail through `requireHeld` or the process).
- **The renamed title** `exports_$method_SessionChatDoesNotHold_Rejects ($target)` reads `method_SessionChat…` as one
  key; it becomes `exports_SessionChatDoesNotHold_Rejects ($method, $target)`. Task 13 sweeps every other file.

GIVEN a disposed chat part WHEN `close('row-1', 'user')` is called THEN it rejects with `chat is stopped; close
refused`; WHEN `closeSessionsIn('/p')` is called THEN it rejects with `chat is stopped; closeSessionsIn refused`, and
in both cases `endWaits` stays empty (nothing hangs).

Tests (in `start.test.ts`, beside `exports_CloseSessionsIn_EndsNeverCome_ResolvesAtStop`):
- `exports_CallAfterDispose_Rejects ($call)`: `it.each` over `{ call: 'close', run: (exports) => exports.close('row-1',
  'user') }` and `{ call: 'closeSessionsIn', run: (exports) => exports.closeSessionsIn('/p') }`; start the part, start a
  session in `/p` (as the neighbouring test does), `await chat.part.dispose?.('end')`, then expect `run(chat.exports)`
  to reject with `` `chat is stopped; ${call} refused` ``.

Done when: compiles (`npm run typecheck`); `npm test` runs `src/plugins/chat/main/start.test.ts` green; `npm run lint`
clean.

Commit: one commit for the group, e.g. "Chat's close and closeSessionsIn reject once the part is disposed (follow-up:
Chat close/closeSessionsIn never resolve after dispose)"
