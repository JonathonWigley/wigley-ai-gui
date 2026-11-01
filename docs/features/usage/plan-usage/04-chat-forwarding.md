# 04 — Chat forwards agent events and plan usage

Status: done
Type: Task
Wave: 2 · Depends on: 03
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/chat/contract.ts` · modify `src/plugins/chat/main/chat-sessions.ts` · test `src/plugins/chat/main/chat-sessions.test.ts` · modify `src/plugins/chat/main/start.ts`
Consumes:  `AgentEvent`, `PlanRowUpdate`, `AgentProcessEvents.planUsage(update: PlanRowUpdate): void`, `AgentProcessEvents.agentEvent(event: AgentEvent): void` ← 03 · `fakeUsageEvent(turn: number, at: number): UsageAgentEvent`, `fakePlanRowUpdate(turn: number, at: number): PlanRowUpdate` ← 03 · `EventShape`, `PluginEvents` in `src/contracts/plugin.ts` and `ChatProfile` in `src/plugins/chat/contract.ts` (in the tree)
Produces:  `export interface ChatMainEvents extends EventShape { agentEvent: { sessionId: string; profileDir: string | null; event: AgentEvent }; planUsage: { profileDir: string | null; update: PlanRowUpdate }; sessionOpened: { sessionId: string; profileDir: string } }` in `src/plugins/chat/contract.ts`
           `ChatMainExports.profiles(): readonly ChatProfile[]` in `src/plugins/chat/contract.ts`
           `ChatSessionsDeps.emit: PluginEvents<ChatMainEvents>['emit']` in `src/plugins/chat/main/chat-sessions.ts`
Decisions: **the events type**: `ChatMainEvents` takes `extends EventShape`, as `DocsMainEvents` does; its fields are plan.md's. `ChatApi` in `start.ts` takes `ChatMainEvents` as its third type argument, in place of `Record<never, never>`. A contract comment names the three events: `agentEvent` is one agent event of a session chat owns; `planUsage` is the plan rows one of those sessions saw; `sessionOpened` is a session chat now owns, with the profile it opened under. The first two carry the `profileDir` the session's process was started with
           **`sessionOpened`**: `openRow` in `chat-sessions.ts` emits `deps.emit('sessionOpened', { sessionId, profileDir: profileDirOf(profile) })` right after `held.set(sessionId, session)`. `sessions.open` emits `connected` before `held.set` runs, so a `connected` hearer cannot ask chat for the session's profile; this event fires once chat holds the session. A restored row (`chat.restore`) takes the same path and emits it too. `sessionId` is the id `held` keys the session by, the id `agentEvent` carries
           **`profileDir`** is the profile's `configDir` as chat's `profiles` setting writes it (`~/.claude-personal`, not expanded), the same value `AgentStart.profileDir` gets, so a hearer matches it against `profiles()` by equality and can pass it to `AgentHarness.planUsage`. Chat always sends a string; the type keeps `null` for the harness default, as `AgentStart` does
           **the profile a process is started with is the one its events carry**: `processEvents` gains a fourth parameter, `profileDir: string`, which `startProcess` passes as `profileDirOf(profile)`. A later change to the `profiles` setting does not change the dir a running process's events carry, since that process still runs on the old account
           **forwarding** in `processEvents`: `agentEvent(event)` → `deps.emit('agentEvent', { sessionId, profileDir, event })`; `planUsage(update)` → `deps.emit('planUsage', { profileDir, update })`. Each forwards only while `isLive(session, processStart)`, as `entry` and `controls` do, so an earlier or ended process's late event is dropped. Neither is held in `ChatSessionState` or sent over chat's channel: chat's page draws neither
           **`start.ts`** passes `emit: (event, data) => api.events.emit(event, data)` to `createChatSessions`, written as its `send` line is
           **`profiles()` export**: `profiles` (the `start.ts` const that reads `api.settings().profiles` at each call). Its contract comment: "Chat's profiles, in settings order, read at each call. The first is chat's default profile: the one a drive `chat.start` takes when it names none, and the only choice the start prompt skips to." `ChatProfile` gains no default flag: plan.md's `ProfilePlan.isDefault` is the first profile's (05 marks it)
           **preview**: `src/plugins/chat/main/preview/` builds no `AgentProcessEvents` (its session has no process), so it forwards nothing and does not change
GIVEN a session started under `personal` WHEN its process emits a `usage` agent event THEN chat emits `agentEvent` with the row's `sessionId`, `profileDir: '~/.claude-personal'` and the event unchanged
GIVEN a session opened under `personal` THEN chat emits `sessionOpened` with its `sessionId` and `profileDir: '~/.claude-personal'`, before any `agentEvent` of it
GIVEN that session's process has ended WHEN a late `planUsage` arrives from it THEN chat emits nothing
Tests:     `chat-sessions.test.ts`:
           · `setUp` passes `emit` to `createChatSessions`, recording each call as `{ event, data }` in an `emitted` array it returns
           · new `processEvents_UsageForwarding_<case>` table, each row from `started()` (profile `personal`, row `row-1`), calling `test.process.events.agentEvent(fakeUsageEvent(1, 1000))` or `test.process.events.planUsage(fakePlanRowUpdate(1, 1000))` and asserting the whole `emitted` array:
             · agentEvent → `[{ event: 'agentEvent', data: { sessionId: 'row-1', profileDir: '~/.claude-personal', event: fakeUsageEvent(1, 1000) } }]`
             · planUsage → `[{ event: 'planUsage', data: { profileDir: '~/.claude-personal', update: fakePlanRowUpdate(1, 1000) } }]`
             · `setProfiles([{ name: 'personal', configDir: '/elsewhere' }])` after the start, then agentEvent → `profileDir` still `'~/.claude-personal'`
             · the process's `ended({ code: 0, error: null })` first, then planUsage → `[]`
           · new `openRow_SessionOpened_<case>` table: opening a row under `personal` → `emitted` holds `{ event: 'sessionOpened', data: { sessionId: 'row-1', profileDir: '~/.claude-personal' } }` (the test reads the `emitted` entries named `sessionOpened`, so a start's own events do not matter); a restored row (the path `chat.restore` takes) under `personal` → the same event for its id
           The `start.ts` wiring (the `emit` pass-through and the `profiles` export) is a pass-through: the compile proves it, and 05's use proves it live
Done when: compiles (`npm run typecheck`); `npm run lint` passes; the test gate runs the tests above. Runtime checks are in `09-final-verification.md`
Commit:    one commit for the group

## Proof

Commit e6b295a · proof: diff read: ChatMainEvents, profiles() export, emit dep present; forwarding gated on isLive; typecheck clean; worker ran chat-sessions tests 100/100 · concerns: worker formatted its files via npm exec --offline oxfmt (local binary, no download); oxfmt --check still flags DESIGN.md and docs/keymap.md (pre-existing)
