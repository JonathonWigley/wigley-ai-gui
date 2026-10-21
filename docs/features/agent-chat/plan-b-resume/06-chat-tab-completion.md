# 06 — Chat tab: slash completion

Status: done
Type: Task
Wave: 5 · Depends on: 02, 04, 05
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/page/chat-view.ts` · modify `src/plugins/chat/page/start.ts` (only when plan A
           registered chat's channel message listeners there rather than in `chat-view.ts`; this group follows 05,
           which also edits `start.ts`, so the two never run together)
Consumes:  `EditorOptions`, `EditorCompletions` (`prefix`, `words()`, `offered(words)`, `accepted(word)`) in
           `src/contracts/editor.ts` and `EditorHost.create(parent, doc, events, options?)` ← 02 ·
           `ChatSessionState.commands`, `ChatChannel.messages.commands` in `src/plugins/chat/contract.ts` ← 04 ·
           from plan A, in the tree once it landed (its task 09): the Chat tab's box made with
           `services.editor.create(box, '', events)` in `chat-view.ts`; the page's held `ChatSessionState` per session
           and its `<message> for unknown session <id> ignored` rule; `folderName(projectDir)` (`page/chat-state.ts`);
           the page `log` under source `chat`
Produces:  the Chat tab's box created with `{ completions: { prefix: '/', words, offered, accepted } }`; the page's
           `commands` message handler; log lines `completions offered: <words>` and `completion accepted: /<word>`
Decisions: the commands come from `AgentProcessEvents.commands` (plan A reports them; Claude's `slash_commands` then
           `skills`, without `/`), carried by chat main's `commands` message and the state's `commands` (04) ·
           `words` reads the session's held state each call (`() => state.commands`), never a list captured at
           creation, so commands that arrive after the box exists, or after a reload's `sessions()` answer, are offered ·
           the `commands` message replaces the held state's `commands`; for a session the page holds no tab for it logs
           `commands for unknown session <id> ignored`, as plan A's other messages do; it logs nothing otherwise ·
           `offered(words)` logs `completions offered: ` and the words each written `/<word>`, joined by `, `
           (`completions offered: /compact, /model`); `accepted(word)` logs `completion accepted: /<word>` · only the
           message box completes: the picker filter and the deny reason box pass no options
GIVEN the self-test's resumed session, its box in insert mode WHEN `/` `f` `a` are typed THEN the page logs
      `[chat] completions offered: /fake-command` (task 07 step 30)
GIVEN that popup WHEN `Tab` runs THEN the page logs `[chat] completion accepted: /fake-command` and the box holds
      `/fake-command ` (task 07 step 31; the fake's recorded send, step 32 and `problems`)
Tests:     none in Vitest — the claims are the editor's DOM behaviour and the page's wiring, pinned by task 07's
           self-test steps 30–32 and its `problems` check of the sent text; the rule of what is offered is
           `prefixMatch`'s tests (02)
Done when: the typecheck and `npm run lint` pass; the self-test steps above pass at the test gate
Commit:    one commit for the group

## Proof

Commit `f6c9e9e`. Proof: diff read (box created with `{ completions: { prefix: '/', … } }`, `commands` handler, both log lines) and `npm run typecheck` pass. The self-test steps 30–32 run at the test gate.
