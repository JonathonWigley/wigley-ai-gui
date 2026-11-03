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
- [ ] [Wake seam in the form service, and the chat adapter](01-wake-seam.md)
- [ ] [Drive: chat.start returns the session's host id](02-drive-host-id.md)

### Wave 2
- [ ] [Wire the wake into forms and the primer](03-wire-forms-primer.md) — after 01

### Wave 3
- [ ] [Doc re-read](04-doc-re-read.md) — after 01, 02, 03

### Wave 4
- [ ] [Final verification](05-final-verification.md) — after 02, 03

## Run log

Review base: 9b795658

### Groups
### Contract changes
### Rulings
### Review rounds
### Test gate
