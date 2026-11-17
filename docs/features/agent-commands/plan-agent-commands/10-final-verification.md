# 10 — Final verification

Status: done
Type: Task
Wave: 4 · Depends on: 09
Plan: [plan.md](plan.md)

Paths are under `wigley-ai-gui/`.

Files: none (verification only)

Consumes:  the built feature of 01–08, and the drive actions `agent-commands.call` and `agent-commands.result` ← 08
Produces:  the evidence below, named in the run log

Decisions:
- Every check runs in one drive run with the fake harness (`.agents/skills/drive/SKILL.md`).
  - Pass `--run <id>` on every command.
  - Start each tool call with `do agent-commands.call '{"sessionId":…,"tool":…,"args":…}'`, and read it with
    `do agent-commands.result '{"callId":…}'` until it is not pending.
- Seed two chat sessions with `do chat.start` twice: A (the caller) and B (the target). For A and B, the result's
  `sessionId` is the row id: use it as the tool's `sessionId` and `session`. For the connected session C (step 7), use
  the `rowId` that `sessions.connect` returns, not its `sessionId`.
- The risky command for the confirm and refusal checks is `chat.stopAll`. It takes no argument, so the confirm's detail
  has no `Argument:` block and reads the same on every run.
- **Answering a confirm.** Use the forms keys in `src/plugins/keymap.ts`: the digit `1` picks Allow and `2` picks Deny.
  Then move to the review and press `<D-Enter>` (`forms.submit` in the `forms.review` scope), as the forms self-test
  does. `query` for the open form before and after shows it closed.
- One real-Claude check is optional and spends tokens. Under `--harness claude`, an agent in A calls `list_commands`
  and `run_command chat.sendTo` itself. Run it only when the fake checks pass, and name it in the report.

GIVEN sessions A and B WHEN A calls `run_command {command: 'chat.sendTo', arg: {sessionId: B, text: 'hello from A'}}` THEN the result is `Ran chat.sendTo.`, B's transcript holds the framed message, and B's turn shows the Tag `from <A's name>`
GIVEN A's tab is shown WHEN A calls `run_command {command: 'workflow.toggleHeadless', session: B}` THEN B turns headless and A's view does not move — a page command run from main with a target
GIVEN A calls `run_command {command: 'chat.focusBox', session: B}` WHEN it settles THEN the result is `chat.focusBox does not act on a given session. Run it without session.`
GIVEN A's tab is shown WHEN A calls `run_command chat.stopAll` and the confirm over A's tabs is denied THEN the result is `The user denied chat.stopAll.`
GIVEN the same call again WHEN the confirm is allowed THEN the result is `Ran chat.stopAll.`
GIVEN A is headless WHEN A calls `run_command chat.stopAll` THEN the result is the refusal pinned in 08, and no form opens
GIVEN any session WHEN it calls `read_state {slot: 'sessions.rows'}` THEN the result is the rows as JSON, A's and B's ids among them

Tests: the drive steps below. Each step records its command and what it showed in the run log.

1. `npm run drive -- start`. Run `do chat.start` twice, giving A and B.
2. `list_commands`: call it from A with `{filter: 'chat.sendTo'}`, expecting one entry with `runsIn: 'main'`. Call it
   with `{filter: 'closeSession'}`, expecting `sessions.closeSession` with `risky: true`, `targets: true` and `runsIn:
   'page'`.
3. sendTo:
   1. Make the call above, then `result`: `Ran chat.sendTo.`
   2. `do sessions.activate '{"rowId":"<B>"}'`, then `screenshot agent-commands-from-tag`. Read it: B's last user turn
      shows a neutral Tag `from <A's name>` and the body `hello from A`, with no frame line.
   3. `query .chat-user-from` for its text and `title`.
   4. Read B's transcript entry text through `read_state` on chat's entries slot for B (find it with `read_state` and
      no slot): it opens with the frame line.
4. Targeted page command:
   1. `do sessions.activate '{"rowId":"<A>"}'`.
   2. Call `workflow.toggleHeadless` with `session: B`; `result` is `Ran workflow.toggleHeadless.`
   3. Check B's headless state through `read_state` (the workflow or chat slot that holds it), and `query` that A's
      Chat tab is still the one shown.
   4. Call it again to turn B back.
5. Untargetable: call `chat.focusBox` with `session: B`. The result is the takes-no-session error.
6. Risky, denied, then allowed:
   1. With A shown, call `chat.stopAll`. `result` is pending.
   2. `screenshot agent-commands-confirm`. Read it: the form shows over A's tabs, titled `Run stop every session's
      process?`, with Deny recommended and nothing picked.
   3. Pick Deny and submit. `result`: `The user denied chat.stopAll.`
   4. Call it again, pick Allow and submit. `result`: `Ran chat.stopAll.`
7. A tab-less caller:
   1. `do sessions.connect`, giving C. Note its `rowId`.
   2. Call `chat.stopAll` from C's `rowId`.
   3. `screenshot agent-commands-confirm-marked`: C's row is marked with a round. Deny it.
8. Headless refusal:
   1. Call `workflow.toggleHeadless` with `session: A` from A.
   2. Call `chat.stopAll` from A: the headless refusal. `query` finds no open form.
   3. Turn A back.
9. `read_state`: call it with `slot: 'sessions.rows'`, expecting JSON that holds A's id. With no slot, expect the id
   list.
10. `npm run drive -- quit`.

Done when: steps 1–10 pass, each with its result text or screenshot named in the run log.
Commit:    none (verification only)

## Proof

Commit dfdc1237a · proof: drive run agentcmd-live, fake harness: steps 1-10 PASS; added checks PASS: overview first paragraph only, failing reporting run main and page carry error text, targeted close of a busy B closes with no end-session confirm, from Tag screenshot · concerns: logged-no-op page handlers (unity-pool.hold, practice.showTab, chat.openImage, docs.openNode, sessions.selectRow) answer Ran to a failing run; a connected caller's row is absent from sessions.rows
