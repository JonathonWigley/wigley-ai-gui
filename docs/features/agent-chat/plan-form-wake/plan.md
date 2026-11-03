# Form wake — plan

Feature: agent chat · Implements: none · Ticket: none
Target: main · Written: 2026-11-02

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

A session the app's chat started picks up on its own once the user submits or cancels a forms round or a feature
primer, even when no tool call is waiting on that form. Today the user types "sent" to resume it.

**The cause** (five GUI transcripts, 2026-10-20 to 2026-11-02). Claude Code moves a long `ask_round` /
`collect_last_round` to the background, so its `draft` arrives as a task notification. The agent ends its turn
there and does not call collect again. With no call waiting, the submit reaches nobody.

**The fix.** The shared form service already knows the moment: a `finish` with no call waiting on the form and none
queued behind it. At that moment it hands its session a one-line message naming the collect tool, through an injected
`AgentFormWake`. Forms and the primer build that wake on chat's `send`. A session chat does not own (a terminal
session connected to the app) gets nothing. The tool contract and the `draft` rule do not change: the wake is a
safety net.

## Architecture

```
page: user submits/cancels ─► channel presenter ─► form-service formListener.finish
                                                     │ store.finish, close in window, wake waiters
                                                     │ no call waiting (callers 0), none queued (askTurn null),
                                                     │ and made under the session's current host id?
                                                     ▼ yes
                                     deps.wake.formFinishedUnheard(sessionId, text)
                                                     │
              forms/primer main: createChatFormWake(chat, log, source)
                                                     │ chat.profileOf(sessionId) === null → nothing
                                                     ▼ owned
                                     chat.send(sessionId, { text, images: [] })  (queues behind a running turn;
                                                                                  starts a resting session's process)
                                                     ▼
                               agent calls collect_last_round / collect_last_primer → finished answers
```

Systems touched: the shared agent-form service (`src/contracts/agent-forms.ts`, `src/shared/agent-forms/`), forms'
and the primer's main parts and manifests, and chat's drive `chat.start` (which now returns the host id the live
check needs). `ChatMainExports.send` and `profileOf` already exist and do not change.

## Preconditions

Each one is re-run by `wigley:make` before the first dispatch.

- Forms and primer depend on `sessions` and `keys` only, and chat depends on `sessions` and `keys`, so adding `chat`
  to forms and primer makes no cycle: `grep -n dependsOn src/plugins/{forms,primer,chat}/manifest.ts`.
- `ChatMainExports` has `send(sessionId, message: UserMessage): Promise<void>` and
  `profileOf(sessionId): string | null`: `grep -n "send(sessionId\|profileOf(sessionId" src/plugins/chat/contract.ts`.
- `UserMessage` is `{ text: string; images: ChatImage[] }` in `src/contracts/agent.ts`:
  `grep -n -A3 "export interface UserMessage" src/contracts/agent.ts`.
- `createAgentFormService` is built in four places, two each in `src/plugins/forms/main/start.ts` and
  `src/plugins/primer/main/start.ts` (live and preview), plus test callers: `grep -rn "createAgentFormService(" src`
  (measured at plan time, re-verify).
- The session id the service holds (`AgentFormOwner.id`) is the sessions row id, the same id `ChatSessionState.sessionId`
  and `ChatMainExports.send` take: `src/contracts/agent-forms.ts` (`id` is the app's own id) and
  `src/plugins/chat/contract.ts` (`sessionId` is the sessions plugin's id for the row).
- `git fetch` from `github-personal` failed at plan time (publickey). Local `main` was 103 commits ahead of the
  last-fetched `origin/main`. Re-run `git fetch origin` and bring `main` up to date when it reaches the remote.

## Docs written ahead

- `wigley-ai-gui` `AGENTS.md`: the agent-forms line (the wake and `AgentFormWake`) and the chat exports line (`send`
  and `profileOf` to forms and the primer). Commit `0b9105cd`.
- `wigley-ai-marketplace` `plugins/wigley/scripts/forms/README.md` § Outcomes, **The wake** paragraph (the
  message text, that a wake for a round already read is ignored, that a cleared conversation gets none, and that
  the `draft` rule still holds). Commits `817df38` and the follow-up commit made with this plan.

## Mandatory Reads

- `AGENTS.md` (repo root): Architecture and the module map (`src/contracts`, `src/shared`, plugins), the plugin
  rules (what a plugin may import, `api.dependency`, manifests' `dependsOn`), Running and testing (`npm test`,
  `npm run selftest -- --plugin <id>`, `npm run drive`)
- `.agents/skills/drive/SKILL.md`: for the final verification task
- `wigley-ai-marketplace/plugins/wigley/scripts/forms/README.md` § Outcomes and § Saved rounds: the hand-back rules
  the wake relies on
- No `CLAUDE*.md` or `.claude/rules/*.md` in the repo: `find . -maxdepth 3 -name 'CLAUDE*.md' -not -path './node_modules/*'; ls .claude/rules 2>/dev/null`

## Design Overview

**After-state flow:** the Architecture diagram above.

**Decisions** (interview round 1 and the design review):

- The app sends a message when a form finishes with no call left to return it. No Stop hook, no change to the
  tool contract (round 1, Q1).
- The message is a one-line pointer to the collect tool. It carries no answers (round 1, Q2). Pinned text:
  `The user ${kind} the ${noun} "${heading}" in the forms app. Call ${collectTool} for its answers.`, where
  `kind` is `submitted` or `cancelled`, `noun` is the type's `noun` (`round`, `primer`), `heading` is
  `type.heading(form)` and `collectTool` is the type's `collectTool`.
- Agents in GUI sessions keep re-calling collect after a draft; the `draft` payload text is unchanged (round 1, Q3).
- **"No call will return it"** is exactly `open.callers === 0 && session.askTurn === null`, read in `finish` before
  any woken waiter has run. `callers` counts calls waiting on this form and queued re-sends of it. `askTurn` covers
  an open-tool call for a *different* form queued behind this one: when that call runs, it hands this form back
  with `earlier_heading`, so it needs no wake.
- A form made before `/clear` moved the session's host id gets no wake: the new conversation never heard of it
  (`session.formsHostId === session.info.sessionId`, cold-read gap).
- The heading goes into the text verbatim: no escaping, collapsing or truncating.
- A cancel wakes too, with `cancelled` in the text (Decided).
- Rounds and primers both get it, through the shared service (Decided).
- Only sessions chat owns get the message (`profileOf` non-null). Any other session, the layout previews and drive
  fixture sessions included, gets nothing (Decided).
- **Design review:**
  - The wake is a seam with two adapters: the chat adapter and a test spy, plus a no-op for the previews. Its
    interface lives in `src/contracts/agent-forms.ts` beside `AgentFormPresenter`.
  - The service composes the text (one home for it). The adapter only delivers.
  - `src/shared/` cannot import a plugin's contract, so the adapter takes a structural target
    (`profileOf`, `send`), the way `AgentFormSessions` restates the sessions exports.
  - A send that rejects is logged and never thrown into `finish`: the user's submit must still succeed.
    `AgentFormWake` states that it does not throw; the service adds no try/catch.
- A duplicate is accepted. When the user submits in the moment between a `draft` returning and the agent's next
  collect, both the collect and the wake land, and the wake's collect replays `lastFinished`. If the agent opened a
  newer round before the queued wake ran, that collect would return the newer round instead. The wake names its
  heading, and the README tells the caller to ignore a wake for a round it already read. The window is a few
  seconds, so no code guards it.

**Out of scope:** the polling turns after each draft (round 1, Q3); terminal sessions; the GUI sessions' draft
interval. The transcripts show 240 s gaps, the app's default, where the README says Claude Code's plugin entry sets
300 s; that is noted in the hand-off reply, not planned here.

## File Structure

Modified:
- `src/contracts/agent-forms.ts`: adds `AgentFormWake`
- `src/shared/agent-forms/form-service.ts`: `AgentFormServiceDeps.wake`, and the wake in `formListener.finish`
- `src/shared/agent-forms/form-service.test.ts`: the wake rows, and `startSession` passes a spy wake
- `src/plugins/forms/manifest.ts`, `src/plugins/primer/manifest.ts`: `dependsOn` gains `'chat'`
- `src/plugins/forms/main/start.ts`, `src/plugins/primer/main/start.ts`: build the live service with the chat wake
  and the preview service with `NO_FORM_WAKE`
- `src/plugins/forms/main/round-type.test.ts`, `src/plugins/primer/main/primer-type.test.ts`: pass `NO_FORM_WAKE`
- `src/plugins/chat/main/chat-sessions.ts` (+ test), `src/plugins/chat/main/start.ts`: `hostSessionIdOf`, and the drive
  `chat.start` result gains `hostSessionId`
- `.agents/skills/drive/SKILL.md`: only where it states `chat.start`'s result

New:
- `src/shared/agent-forms/chat-wake.ts`: `createChatFormWake` and `NO_FORM_WAKE`. Shared because forms and the
  primer both use it
- `src/shared/agent-forms/chat-wake.test.ts`

Boundary rules: `src/shared/agent-forms/` imports only `src/contracts` and `src/shared`, never `src/plugins/chat`.
Forms and primer reach chat only through `api.dependency<ChatMainExports>('chat')`.

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Wake seam in the form service, and the chat adapter](01-wake-seam.md)
- [x] [Drive: chat.start returns the session's host id](02-drive-host-id.md)

### Wave 2
- [x] [Wire the wake into forms and the primer](03-wire-forms-primer.md) — after 01

### Wave 3
- [x] [Doc re-read](04-doc-re-read.md) — after 01, 02, 03

### Wave 4
- [x] [Final verification](05-final-verification.md) — after 02, 03

## Run log

Review base: 9b795658

### Groups
- 02 · 54f72bb2 · diff read: hostSessionIdOf and the { sessionId, hostSessionId } result present as planned; chat-sessions.test.ts and start.test.ts 152 passed; whole-tree typecheck waits on 01 · concerns: no test row pins chat.start's hostSessionId result or its null throw (plan asked none); worker's nvm prefix was refused, ran on default node (v24.22.1 matches .nvmrc)
- 01 · d3ba371b · diff read: AgentFormWake, AgentFormServiceDeps.wake, ChatFormWakeTarget, createChatFormWake, NO_FORM_WAKE present as planned; npm run typecheck passes; worker ran the 4 test files, 107 passed · concerns: re-send row has both callers>0 and askTurn set, so it isolates neither clause (each clause pinned by its own row); rejection test's two microtask flushes depend on promise-chain depth
- 03 · cb955812 + fix 1cac2422 · diff read: dependsOn ['sessions', 'chat', 'keys'] and createChatFormWake on both live services, NO_FORM_WAKE on previews; typecheck and lint pass; plugin-manifests.test.ts passes; selftest --plugin chat,forms,primer failed 92 steps on the first dispatch (start order put chat's left-open chat-second row in forms' wrap steps) and passes after fix 1cac2422 · concerns: first dispatch failed the layer check (forms/primer main may not import chat/contract) and the self-test; the whole self-test is not run, so scripts other than chat that now start before forms are unchecked; forms+primer-only self-test not re-run after the fix
- 04 · no change · no change: AGENTS.md agent-forms and chat entries, the start-order line (733, generic), drive SKILL.md's chat.start result, and the forms README's wake paragraph (round text character for character, primer noun and tool, replayed collect, cleared conversation, non-chat sessions) all match the landed code · concerns: none
- 05 · none (verification) · drive run fw05, fake harness, deadlines 5 then restored to 240: (1) round in chat-owned row 447145ea, submitted after the draft → Chat tab shows 'The user submitted the round "Layout preview" in the forms app. Call collect_last_round for its answers.' and the fake echo; (2) 120 s deadline, submit at once → forms.answers submitted, Chat tab empty; (3) primer → 'The user submitted the primer "Sample feature" in the forms app. Call collect_last_primer for its answers.' and echo; round text matches README's The wake line character for character; captures c1/c2/c3 read by the lead · PASS · concerns: cancel path not driven live (pinned by the form-service cancelled row)
### Contract changes
### Rulings
- drive SKILL.md stated no chat.start result, so one sentence was added after the chat.start profile line — the Files field expects the skill to state it — one sentence to drop if wrong · group 02 · group 02
- start.test.ts (outside Files) gains hostSessionIdOf on its fakeChat, no new row — the widened Pick needs it to typecheck — none · group 02 · group 02
- forms and primer start.ts pass NO_FORM_WAKE to all four services as a placeholder so the tree compiles — group 03 replaces the two live ones with createChatFormWake — if 03 misses it the live app never wakes · group 01 · group 01
- host-move GIVEN is its own it in the 'a session moved to a new host id' block, not a column of its it.each — that table's second row has a waiting call, so a wake column would pass trivially — one extra test · group 01 · group 01
- forms' three wrap steps repeat their key until their row activates (stepAcrossWrapTo, max 12), rather than chat's script closing chat-second at its end — scripts here close the previous run's fixture at their next open, and forms must hold any earlier script's rows — fails at the cap past 12 foreign rows · group 03 · group 03
- forms/main and primer/main LAYERS entries gain src/plugins/chat/contract.ts, as agents/main has — the layer check refused the import — none · group 03 · group 03
- chat/main/start.ts reformatted with oxfmt on that file only — lint flagged group 02's lines — formatting only · group 03 · group 03
- README's primer wording ('a primer says primer and names collect_last_primer') left as is — the primer type's heading is its feature name, so the line is true — none · group 04 · group 04
### Review rounds
- round 1 (implementation review, correctness + plan-and-design) · efe615c3 · NEEDS FIXES: 3 Minor — 1 chat.start result unpinned (fix), 2 ROWS_LEFT_OPEN_MAX off by one (fix), 3 'in the forms app' wording (left: text pinned by the user's interview answer, round 1 Q2)
- round 2 (re-review, correctness on fix 1c0d1a26) · 1c0d1a26 · PASS: findings 1 and 2 closed, nothing broken
### Test gate
- form-service, chat-wake, round-type, primer-type (the wake rows and NO_FORM_WAKE callers), chat-sessions and chat start (hostSessionIdOf, the drive result), plugin-manifests (the start order): 7 files, 323 passed; whole Vitest suite also run since it takes 14 s: 5629 passed, no type errors; selftest --plugin chat,forms,primer passed in 03's fix proof · PASS
- after fix 1c0d1a26: start.test.ts 26 passed, typecheck and lint pass, selftest --plugin chat,forms,primer all passed · PASS
