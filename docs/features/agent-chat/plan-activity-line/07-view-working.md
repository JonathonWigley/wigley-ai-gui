# 07 — Chat view feeds the working flag

Status: not started
Type: Task
Wave: 4 · Depends on: 02, 06
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/page/chat-state.ts` · test `src/plugins/chat/page/chat-state.test.ts` · modify `src/plugins/chat/page/chat-view.ts`
Consumes:  `EntryList.setWorking(working: boolean): void` in `src/plugins/chat/page/entry-list.ts` ← 06
Produces:  `export function isWorking(state: Pick<ChatSessionState, 'running' | 'activity'>): boolean` in `src/plugins/chat/page/chat-state.ts`
Decisions: `isWorking` is `state.running && state.activity === 'working'`; `waiting` is not working (plan.md § Decisions, Live)
           `chat-view.ts` calls `tab.entries.setWorking(isWorking(tab.state))` after `tab.state` changes in the `activity`, `sessionRunning` and `sessionRested` handlers, and in `createTab` right after `entries.rebuild(state.entries)`. The `entry` and `entries` handlers need no call: the list keeps its own flag across `put` and `rebuild`
           02 already edited `chat-view.ts` (the `is-box-focused` toggle); keep it
GIVEN running true and activity `working` WHEN `isWorking` runs THEN it is true; with activity `waiting` or `idle`, or with running false, it is false
Tests:     `chat-state.test.ts`: `isWorking_RunningAndActivity_TrueOnlyWhenRunningAndWorking`, an `it.each` over the four rows above
Done when: compiles; the test gate runs `chat-state.test.ts`
Commit:    one commit for the group

## Proof

