# 05 — Clear commands and self-test step

Status: done
Type: Batch
Wave: 3 · Depends on: 03
Plan: [plan.md](plan.md)

Files:     create `src/plugins/chat/page/clear-commands.ts` · modify `src/plugins/chat/page/start.ts` · modify `src/plugins/chat/main/selftest-script.ts`
Consumes:  `clear(sessionId: string): void` in `ChatChannel`'s invoke map ← 03 · log `conversation cleared in <folder>` ← 03 · `SlashCommands.add`, `sendKeys` (in the tree)
Produces:  `export function addClearCommands(deps: ClearCommandDeps): Disposable[]` in `src/plugins/chat/page/clear-commands.ts`
Decisions: `/clear`, `/reset`, `/new` all clear (Decided) · same shape as `account-commands.ts` (writing-code, match the pattern)

- `clear-commands.ts`: `ClearCommandDeps { commands: SlashCommands; channel: Pick<PageChannel<ChatChannel>, 'invoke'> }`.
  Registers `clear`, `reset` and `new`, each `run: ({ sessionId }) => channel.invoke('clear', sessionId)`, with
  description `Clear the conversation and restart the agent` on all three (the completion list shows each).
- `page/start.ts`: calls `addClearCommands` beside `addAccountCommands`, discarding its return the same way.
- Self-test: a `clear` group (`name: 'clear'`, `why` one line) placed right after `resting session` in `GROUPS`,
  which ends with `chat-second`'s Chat tab shown and holding entries (`[chat] assistant entry added in chat-second`).
  One step: `keys: sendKeys('/clear')`, `expect: '[chat] conversation cleared in chat-second'`, `checksFit: true`
  so the run captures the one-notice tab. It clears `chat-second`, never `chat-selftest`: the end-of-run fixture
  check (`fixtureProblems`, `selftestProcess`) reads the last `resume: false` process in the `chat-selftest`
  folder and its `EXPECTED_CALLS`, which a clear there would replace. Confirm at implementation that no later group
  reads `chat-second`'s earlier entries (at plan time none does: its steps sit in the first two groups).

Tests:     none new: the commands are pass-throughs to the channel (writing-tests, What earns neither); the self-test step is the live check, run in task 07.
Done when: compiles; the self-test script type-checks.
Commit:    one commit for the group

## Proof

Commit e67ef59 · proof: diff read: addClearCommands present, registered in page start; selftest clear group after resting session; typecheck and lint clean · concerns: fact sheet wrong: resting session ends on chat-selftest, so the clear group shows chat-second first and switches back
