# Saved chat sessions — plan

Feature: agent-chat · Implements: none · Ticket: none
Target: main · Written: 2026-10-27

REQUIRED SUB-SKILL: Use wigley:make to implement this plan

## Goal

Every session the app's chat runs survives a quit, relaunch or `install-app` and comes back in the sidebar,
resting until the user's next message starts its process. A session whose process exits rests the same way. Only
the user closing a row removes it, from the app's view alone: the transcript and the start prompt's saved-session
list keep it.

## Architecture

- **chat main** (`src/plugins/chat/main/`): a new `open-sessions.ts` store over chat's plugin data `Files`;
  `chat-sessions.ts` gains restore, the resting state, start on first send, lazy history and saving; `start.ts`
  wires the store, the restore and the sessions `selected` event.
- **sessions main** (`src/plugins/sessions/`): a generic `selected` event when the selected row changes, so chat
  saves the selection without polling.
- **chat page** (`src/plugins/chat/page/`, `src/plugins/keymap.ts`, `src/plugins/chat/manifest.ts`): the `ended`
  state and the `chat.ended` scope go; a tab reads `running`, asks for its history on first show, and takes a full
  entries replace.
- **chat contract** (`src/plugins/chat/contract.ts`): `ended` becomes `running`, `sessionEnded` becomes
  `sessionRested`, `loadHistory` and the `entries` message are added, `SlashCommandContext.ended` goes.

## Preconditions

Re-run each before the first dispatch.

- `git -C ~/Documents/ai-dev/wigley-ai-gui merge-base --is-ancestor 3ff5036 HEAD` exits 0 (the docs written ahead
  are in the target).
- `test -f ~/Documents/ai-dev/wigley-ai-gui/src/plugins/chat/main/archived-sessions.ts` exits 0 (the store's
  pattern, task 01).
- `grep -n "ended: boolean" ~/Documents/ai-dev/wigley-ai-gui/src/plugins/chat/contract.ts` prints two lines,
  `ChatSessionState` and `SlashCommandContext` (measured at plan time, re-verify).
- `grep -c "chat.ended" ~/Documents/ai-dev/wigley-ai-gui/src/plugins/keymap.ts` prints 5: the two helpers'
  scope types and three bind lines (measured at plan time, re-verify).
- `npm run typecheck` passes on the target before any task.

## Docs written ahead

Commit `3ff5036`:

- `docs/features/agent-chat/design.md` — glossary **Owned session**, Chat plugin § Chat tab, the new § Saved
  sessions bullet, § App slash commands, § Resume and archive.
- `AGENTS.md` — the owned-session paragraph in Architecture.

## Mandatory Reads

- `AGENTS.md` (repo root) — Intent, Architecture (layers, plugins, the composition root), Running and testing.
- `DESIGN.md` — task 04 only (the composer's chips and send state).
- `docs/keymap.md` — task 04 only (removing the `chat.ended` binds).
- `docs/features/agent-chat/design.md` — Chat plugin section, § Saved sessions above all.
- `.agents/skills/drive/SKILL.md` — task 07.
- No `CLAUDE*.md`, `AGENTS.local.md` or `.claude/rules/*.md` exist in the repo (measured at plan time:
  `find . -name 'CLAUDE*.md' -o -name 'AGENTS*.md' -not -path './node_modules/*'` lists only `./AGENTS.md`).

## Design Overview

```
 start ─► chat main start ─► openSessions.load() ─► chatSessions.restore(saved)
                                                    │  per record: sessions.open({select:false}) → resting row
                                                    │  notices: quit mid-turn · profile missing
                                                    └► sessions.activate(saved selected row)

 Chat tab first shown ─► loadHistory(rowId) ─► harness.history ─► entries = history ++ notices ─► `entries` msg

 send in resting row ─► startProcess(resume = sent) ─► harness.start ─► process.send(message)
 process exits ─────► running=false, notice, `sessionRested` ─► row stays, rests
 every change (open, first send, busy flip, `selected`, close) ─► openSessions.save(snapshot)
 user close ─► sessions `closed` ─► chat.closed ─► record dropped from snapshot (transcript untouched)
 quit / killAll / plugin dispose ─► processes killed, records kept
```

Decisions (interview rounds 1–3, all on the recommended choice):

- Rows come back resting; a process starts on the first message sent after the relaunch (round 1).
- Closing a row is the explicit remove: gone from the sidebar for good, the end-session confirmation only while
  Claude is working, as today (rounds 1 and 3).
- Removing does not archive: the session stays resumable from the start prompt (round 1).
- A process that exits while the app runs leaves its row resting, replacing `ended` and `chat.ended` (round 2).
- Every session chat runs is saved, resumed and launched ones included; relay-connected terminal sessions are not.
- Row order and the selected row are restored; a resting row looks idle in the sidebar.
- Chat owns persistence; the sessions plugin stays generic and gains only the `selected` event.
- The store follows `archived-sessions.ts`: writes one after another, an unreadable file logged and never
  overwritten.
- History is read the first time a restored row's Chat tab shows; start reads no transcripts.
- Picking a session in the start prompt that already has a chat row selects that row.

Out of scope:

- Terminal (relay-connected) sessions: the app did not start them.
- A quit confirmation while a turn runs: `install-app` waits only 15 s for the app to quit.
- Restoring a turn's partial output past what the transcript holds.

## File Structure

Existing files modified:

- `src/plugins/sessions/contract.ts`, `src/plugins/sessions/main/session-list.ts` (02; sessions' `start.ts` passes
  `emit` through and needs no change)
- `src/plugins/chat/contract.ts`, `src/plugins/chat/main/chat-sessions.ts`, `src/plugins/chat/main/start.ts` (03)
- `src/plugins/chat/page/chat-view.ts`, `chat-commands.ts`, `attachments.ts`, `account-commands.ts`, `start.ts`,
  `src/plugins/chat/manifest.ts`, `src/plugins/keymap.ts` (04)
- `src/plugins/chat/main/selftest-script.ts` (05)

New files:

- `src/plugins/chat/main/open-sessions.ts` and its test (01) — the saved-session store, beside
  `archived-sessions.ts` and `recent-folders.ts`, the two stores chat already keeps in its plugin data.

Shared names (every task uses these exactly):

- `export const OPEN_SESSIONS_FILE = 'open-sessions.json'` in `open-sessions.ts`
- `export interface SavedSession { hostSessionId: string; projectDir: string; profile: string; sent: boolean; busy: boolean }`
- `export interface SavedSessions { sessions: SavedSession[]; selectedHostSessionId: string | null }`
- `export interface OpenSessions { load(): Promise<SavedSessions>; save(snapshot: SavedSessions): Promise<void> }`
- `export function createOpenSessions(data: Files): OpenSessions`
- `SessionsMainEvents.selected: { sessionId: string | null }`
- `ChatSessionState.running: boolean` (replaces `ended`)
- `ChatChannel.invoke.loadHistory(sessionId: string): Promise<void>`
- `ChatChannel.messages.entries: { sessionId: string; entries: ChatEntry[] }`
- `ChatChannel.messages.sessionRested: { sessionId: string; error: string | null }` (replaces `sessionEnded`)
- `ChatChannel.messages.sessionRunning: { sessionId: string }`
- the log line `session <rowId> process started (resume <true|false>)` (task 03, read by task 07)
- `ChatSessions.restore(saved: SavedSessions): void`, `ChatSessions.loadHistory(sessionId: string): Promise<void>`,
  `ChatSessions.selected(sessionId: string | null): void`

Boundary rules: chat reaches sessions only through `SessionsMainExports` and its events; `scripts/check-layers.mts`
needs no new entry (the new file sits in an existing layer).

## Tasks

> `wigley:make` ticks a box once its group is committed and proved, and sets `Status: done` in the
> task document in the same change. The run is done when every box is ticked.

### Wave 1
- [x] [Open-sessions store](01-open-sessions-store.md)
- [x] [Sessions selected event](02-sessions-selected-event.md)

### Wave 2
- [x] [Chat main: resting and restored sessions](03-chat-main-resting-sessions.md) — after 01, 02

### Wave 3
- [x] [Chat page: resting tabs](04-chat-page-resting-tabs.md) — after 03

### Wave 4
- [x] [Self-test: resting session](05-selftest-resting-session.md) — after 03, 04

### Wave 5
- [x] [Doc re-read](06-doc-re-read.md) — after 05
- [x] [Final verification](07-final-verification.md) — after 05

## Run log

Review base: f676c293b1c5b8de5ce197b9ebf280691835f557

### Groups
- 01 · 54aff62 · diff read: every Produces present in open-sessions.ts; typecheck clean; open-sessions.test.ts 9 cases pass · concerns: load_FileShape_ReadsOrRejects split into two it.each tables (snapshot rows, reject rows)
- 02 · 069fb20 · diff read: selected present in SessionsMainEvents with doc comment; typecheck clean; session-list.test.ts 50 pass · concerns: three existing tests gained the selected call in exact expectations; 'activate of a marked selected row' approximated, since a selected row cannot carry a mark
- 03 · e04bc7f · diff read: every Produces present; typecheck errors only under src/plugins/chat/page/ (11); chat main tests 127 pass · concerns: selftest-script still expects chat.ended and an ended second session (task 05); old process controls/commands stay in state while resting (task 04 may hide); exit-with-error notice reads '(exit code 1): boom. Your next…' so test asserts contains '): boom'; fake sessions.open numbers rows row-<n>; send toast relies on sync throw, unverified end to end
- 04 · 63d5732 · diff read: ChatTabScope 'chat' only, chat.ended gone from keymap/manifest, handlers for entries/sessionRunning/sessionRested and loadHistory present; typecheck clean; lint pass; page tests 138 pass · concerns: selftest-script still expects chat.ended (task 05); design.md:210 still documents ended in run({...}) (task 06); sessionRested for a failed new start finds no tab so the stopped toast may not show; a pickMode fixture text still says 'has ended'
- 05 · 0625058 · diff read: RESTING_SESSION_STEPS / 'resting session' group present; typecheck clean; npm run selftest all passed (lead re-run) · concerns: the fake's process for chat-second is unchecked (selftestProcess filters to the self-test project), as before
- 06 · 6a27f81 · diff read: six stale lines in design.md fixed (ended arg, /logout and /status notices, selection null, save after start, restore skips, unreadable file); AGENTS.md and the rest checked true; lint pass · concerns: none
- 07 · b3e9123 · drive runs r72/r73: checks 1,2,3,6 pass; 4 passes the close/no-return half, the saved-list half not settleable on the fake (fixed two-session list) and read from code (close touches no archive or transcript); 5 failed (entry-id clash on second process) and 6 showed the start-selected row not saved — both fixed in b3e9123, re-run chk072 passes A and B · concerns: a restored row never sent to reads history anyway and shows 'Earlier conversation not read' (error) on the fake; real Claude has no transcript for an unsent session either; isLive checks the row not the process, so a late ended from an old process could touch the new one
### Contract changes
- AccountCommandDeps.toast: present → removed · why: no path uses it once the toast branch is gone · consumers: none · group 04
### Rulings
- the most recent load() decides the save block: a later clean load lifts it — lets a repaired file be written without restart — a save after a repaired file writes (harmless) · group 01 · group 01
- save() does not re-read the file; the unreadable flag is set by load() alone — whole-snapshot writes — a file damaged after a clean load is overwritten · group 01 · group 01
- validation allows extra fields on snapshot and records — only named fields checked — a malformed extra field is kept silently · group 01 · group 01
- the one selection comparison sits in sendState, emitting selected after stateChanged — the only single place that also orders after the state — a selection change that skips sendState emits late, with the next state · group 02 · group 02
- selected fires before connected/closed/ended in the same action — follows from sendState — a consumer needing the other order sees it reversed · group 02 · group 02
- HeldSession holds no profileName (state.profile is the name, looked up at each start) and gains hostId — one home for the name — internal only · group 03 · group 03
- a rejected load calls restore with an empty snapshot so saving starts; the store refuses each write and it is logged — no extra ChatSessions method — one log line per change while the file is unreadable · group 03 · group 03
- saved selection written null when it names no held row — file never points at a dropped record — closed-then-relaunched selection restores to none · group 03 · group 03
- restore after killAll does nothing and logs 'open sessions not restored: chat is stopping' — guards a part disposed before load resolves — none seen · group 03 · group 03
- a restore record whose sessions.open throws is logged and skipped — one bad record does not stop the rest — that record is lost from the next save · group 03 · group 03
- restore notices go out as entry messages after sessionStarted — reuse notice path — page handles them as separate entries · group 03 · group 03
- new/resume/launch save only after the start succeeds — a failed start never writes its record · group 03 · group 03
- no resting rows in attachments/slash-commands tests: ImageTab and SlashCommandContext carry no running field, so resting equals running there; ended-only cases deleted, resting rows live in chat-commands.test.ts — cost: none · group 04 · group 04
- entries logs '<n> entries read in <name>', sessionRunning logs '<name> running'; loadHistory rejection toast reuses the log text — spec named none — wording only · group 04 · group 04
- composer anchors its keys once in chat.chat; send never disabled; running indicator hidden while resting — cost: none · group 04 · group 04
- resume list group picks the folder by name (/chat-selftest Enter), since restarting chat-second records its folder newest — key path only — none · group 05 · group 05
- missing-profile send described as a 'message not sent' toast naming the profile, not the exact error string — reworded errors don't stale the doc — none · group 06 · group 06
- first process of a row keeps unprefixed entry ids; later processes get process-<n>: — smaller change — a consumer reading harness ids back would see the prefix · lead (fix b3e9123)
### Review rounds
- R1 implementation review · c4b411f · NEEDS FIXES (3 important, 4 minor, 1 pre-existing; 4 applied by lead in the next commit)
### Test gate
- full vitest suite (npm test) — the range touches the chat contract both sides, sessions and keymap, and the whole suite runs in seconds, covering every planned test (open-sessions, session-list, chat-sessions, start, the four page files) · 237 files / 3619 tests pass; npm run selftest all passed at 0625058
