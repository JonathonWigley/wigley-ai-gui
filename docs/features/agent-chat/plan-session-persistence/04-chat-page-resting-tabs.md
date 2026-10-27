# 04 — Chat page: resting tabs

Status: not started
Type: Task
Wave: 3 · Depends on: 03
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/page/chat-view.ts` · modify `src/plugins/chat/page/chat-commands.ts` ·
           modify `src/plugins/chat/page/attachments.ts` · modify `src/plugins/chat/page/account-commands.ts` ·
           modify `src/plugins/chat/page/chat-state.ts` (only if it reads `ended`) ·
           modify `src/plugins/chat/page/start.ts` (its summary comment on ended tabs) ·
           modify `src/plugins/chat/manifest.ts` · modify `src/plugins/keymap.ts` ·
           test `src/plugins/chat/page/chat-commands.test.ts`, `attachments.test.ts`, `slash-commands.test.ts`,
           `sign-in-flow.test.ts` (each where it builds or asserts `ended`)
Consumes:  `ChatSessionState.running`, `ChatChannel.invoke.loadHistory`, `ChatChannel.messages.entries`,
           `ChatChannel.messages.sessionRested`, `ChatChannel.messages.sessionRunning`, `SlashCommandContext`
           without `ended` ← 03
Produces:  `export type ChatTabScope = 'chat'` in `src/plugins/chat/page/chat-view.ts` (the `'ended'` member gone;
           the type stays, so `page/start.ts`'s `setScope` is unchanged)
Decisions: one state for a session with no process; `chat.ended` goes (round 2, design review) · a resting row looks
           idle in the sidebar (round 2 notice) · history read on first show (design review) · close confirms only
           while Claude is working (round 3)

## Behaviour

- **HeldTab** drops `ended`; whatever read it reads `!state.running` where the meaning is "no process" (interrupt,
  control pickers, the control chips' disabled state) and nothing where the meaning was "takes no messages" (send,
  attachments, notices: a resting session takes all three). `ChatSession`'s `ended` getter in `chat-commands.ts`
  becomes `running`.
- **Scope**: every Chat tab keys in `chat.chat`. Remove the `ended` scope from the manifest's `scopes`, the
  `chatEntryPageBinds('chat.ended')`, `chatBoxBinds('chat.ended')` and `chat.ended` send binds from `keymap.ts`, and
  narrow those two helpers' scope parameter (or drop it when only `chat.chat` is left). The tab's `bar.setScope` and
  `deps.setScope` calls on a state change go with it.
- **sessionRested** replaces the `sessionEnded` handler: `running = false`, redraw the bar (chips disabled, send
  enabled), status `''`, the log lines `<name> rested` / `<name> rested: <error>`, and the error toast as today
  (`<name> stopped: <error>`).
- **sessionRunning**: `running = true`, redraw the bar (chips enabled).
- **entries** message: replace the tab's entries with the payload and redraw them, keeping the user's entry focus
  when it still exists.
- **First show**: the first time a tab is shown in this page load, `channel.invoke('loadHistory', sessionId)`; a
  rejection is logged (`history not loaded: <reason>`) and toasted as an error.
- **Send**: drop the `ended` early return in `chat-commands.ts`; main starts a resting session's process. The
  existing `Message not sent: <reason>` toast covers a missing profile.
- **inLiveSession** becomes "running": a resting session logs `<name> has no running process` for interrupt and
  control picks.
- **account-commands**: `/logout` and `/status` always report through the `notice` call; the toast branch and its
  comment go.
- **attachments**: the ended refusal goes; a resting tab attaches files as a running one does.
- **mayClose**: busy is `state.running && state.activity !== 'idle' && !closeConfirmed`.
- **Status**: `tabStatus(activity)` for every tab; a resting tab's activity is idle, so its status is empty.
- Rewrite the comments in `chat-view.ts` that describe the live/ended scope switch (the `shown` callback's
  comment above `deps.setScope`).

GIVEN a resting tab WHEN the user sends a message THEN the send reaches main (no `has ended` log) and the composer
keys stay in `chat.chat`.

Tests:     update the four page test files' fixtures from `ended` to `running`; add rows to the tests that own each rule:
           `chat-commands.test.ts` — the send test gains a resting-session row asserting the `send` invoke; the
           interrupt or control test gains a resting row asserting no invoke and the `has no running process` log
           `attachments.test.ts` — the attach test gains a resting-tab row that attaches
           `slash-commands.test.ts` / `account-commands` owner — `/status` in a resting session invokes `notice`
           Delete the cases that pinned the ended refusals, since that behaviour is gone.
Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above and the four files as a
           whole
Commit:    one commit for the group

## Proof
