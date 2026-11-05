# 07 — The session-log plugin

Status: done
Type: Task
Wave: 4 · Depends on: 01, 02, 03
Plan: [plan.md](plan.md)

Files:     create `src/plugins/session-log/manifest.ts` · create `src/plugins/session-log/main/start.ts` · create `src/plugins/session-log/main/session-event-log.ts` · create `src/plugins/session-log/main/recently-closed.ts` · modify `src/plugins/manifests.ts` · modify `src/plugins/main.ts` · test `src/plugins/session-log/main/start.test.ts` · test `src/plugins/session-log/main/session-event-log.test.ts` · test `src/plugins/session-log/main/recently-closed.test.ts`
Consumes:  `ConnectedSessionEvent`, `editableTitle` ← 01
           the chat events and types ← 02
           `addResumeSection`, `ResumeSection`, `ResumeSectionRow` ← 03
Produces:  `sessionLogManifest` in `src/plugins/session-log/manifest.ts`
           `sessionLogMainPart: MainPart<typeof sessionLogManifest>` in `src/plugins/session-log/main/start.ts`
           `export const SESSION_EVENTS_FILE = 'session-events.jsonl'` in `src/plugins/session-log/main/session-event-log.ts`
           `export function createSessionEventLog(deps: { files: Pick<Files, 'append' | 'read'>; log: PluginLog }): SessionEventLog` in `session-event-log.ts`
           `export function recentlyClosed(entries: readonly SessionLogEntry[], count: number, isResumable: (hostSessionId: string) => boolean): ResumeSectionRow[]` in `src/plugins/session-log/main/recently-closed.ts`
Decisions: its own plugin (the user's choice) · `recentlyClosedCount` is a setting, default 10 (the user's choice) · `profileDir` stays out of the `opened` line, because `profile` names it and a config folder can move · the file is append-only and never trimmed · the file is read at each section ask: the start prompt is cold code and the fold stays pure · the shape copies `auto-compact` (`AGENTS.md` § A plugin)

**Manifest.** `id: 'session-log'`, `dependsOn: { main: ['chat', 'sessions'], page: [] }`, `settings: { recentlyClosedCount: 10 }`, with `settingInfo`: label `Recently closed sessions`, description `How many recently closed sessions the start prompt lists; 0 hides the section.`

**Log lines.** `SessionLogEntry` is a union in `session-event-log.ts`. Each line has `at`, from `services.clock`, and `event`:

```
opened             sessionId hostSessionId projectDir profile origin
closed             sessionId hostSessionId projectDir profile titles sent reason
cleared            sessionId oldHostSessionId newHostSessionId projectDir profile titles sent
processEnded       sessionId hostSessionId reason code error
archived           hostSessionId archived
terminalConnected  sessionId hostSessionId projectDir harness
terminalEnded      sessionId hostSessionId projectDir
```

**`SessionEventLog`.**

- `append(entry): Promise<void>` orders appends one after another, as `agent-log.ts` does. A failed append logs `event not logged: <error>`, and the next append still runs. The promise never rejects.
- `entries(): Promise<SessionLogEntry[]>` waits for the last append, then reads the file. A missing file gives `[]`. A line that does not parse, as a crash's partial tail, or that parses to a value with no known `event`, is skipped and logged. Another read failure rejects, and chat logs it.
- `settled(): Promise<void>` resolves when the last append has settled. The part's `dispose` returns it, as chat's `dispose` returns its last save, because a quit does not wait for other work.

**`recentlyClosed`.** Walk `entries` from newest to oldest:

- A `closed` entry with reason `user` and `sent` true is a candidate, with host id `hostSessionId`.
- A `cleared` entry with `sent` true is a candidate, with host id `oldHostSessionId`.
- The first candidate per host id wins. Later ones are skipped.
- A candidate joins when `isResumable(hostId)` is true.
- Stop at `count`. A `count` below 1 gives `[]`. Floor a fractional `count`.
- Reverse the kept rows before return, so the newest row is last, next to the cursor.
- A row's `title` is `editableTitle(titles)`, or `Untitled session` when that is empty. Its `at` is the entry's `at`.

**The part.**

- It maps each chat event to one `append`.
- `sessions.connected` with `owned` false appends `terminalConnected`, and keeps `{ hostSessionId, projectDir }` in a map under the row id. `hostSessionId` is `info.sessionId`. A null field stays JSON `null`. An owned row appends nothing.
- `sessions.ended` carries only the row id. For an id in the map it appends `terminalEnded` from the kept values, and removes the id.
- It registers `{ title: 'Recently closed', rows }`. `rows` reads `entries()` and folds with `api.settings().recentlyClosedCount`, read at each ask.

GIVEN entries: A closed, B closed, A resumed and closed again WHEN folded THEN the order is B, A, each once, with A's newest title
GIVEN a candidate with no titles WHEN folded THEN its title is `Untitled session`
GIVEN four candidates WHEN folded with count 0, 0.5, -1 and 2.9 THEN the row counts are 0, 0, 0 and 2, and the 2 are the newest
GIVEN a close with `start-failed`, a close with `project-closed`, and a close with `sent` false WHEN folded THEN none lists
GIVEN a `cleared` entry with `sent` true WHEN folded THEN its old host id lists with its title
GIVEN three candidates, the newest not resumable, and count 2 WHEN folded THEN the other two list
GIVEN a file whose last line is cut, and a line holding `null` WHEN `entries` reads it THEN it returns the whole lines and logs each skip
GIVEN two appends with no await between WHEN both settle THEN both lines are whole and in order
GIVEN a failed append WHEN the next append runs THEN its line is written
GIVEN a connected row with `owned` true WHEN it connects and ends THEN no line is written
GIVEN a connected row with `owned` false WHEN it connects and ends THEN both terminal lines are written
GIVEN `sessionClosed` WHEN the part hears it THEN one `closed` line is written holding every field and `at`
GIVEN a change to `recentlyClosedCount` WHEN the section is asked again THEN the new count applies
GIVEN the plugin stops WHEN its registrations are disposed THEN chat's section is gone, and `dispose` waits for the last append
Tests:     `recently-closed.test.ts`: tables `recentlyClosed_Entries_ListUserClosesOnceNewestLast` (a row for the `cleared` candidate under its old id, a row for `Untitled session`), `recentlyClosed_Excluded_NotListed`, `recentlyClosed_Count_CapsAfterResumable` (rows for each count above). `session-event-log.test.ts`: `entries_BadLines_SkipsAndLogs`, `append_NotAwaited_KeepsOrder` (the fake holds the first `append` until the second call has run, then releases it, and the file holds line 1 then line 2), `append_Fails_NextStillWrites`, `entries_MissingFile_IsEmpty`. `start.test.ts`, on `startMainPart` with `fakeDependency`, as `auto-compact/main/start.test.ts` does: `connected_OwnedRow_WritesNothing`, `connected_TerminalRow_WritesBothLines`, `chatEvents_EachEvent_WritesItsLine` (a table), `section_CountSetting_ReadAtEachAsk`, `dispose_WaitsForLastAppend`.
Done when: compiles; `npm run lint` passes, the layer check included; the test gate runs the tests above
Commit:    one commit for the group

## Proof

Commit 94e631e5 · proof: diff read; typecheck and lint pass · concerns: a crash's partial tail has no newline, so the next start's first append joins it and that line is lost; isSessionLogEntry checks only event, so a known event with a missing field makes recentlyClosed throw; contracts/plugin.ts:786 says the app may exit before dispose settles, so the last appends before a quit may be lost; the terminal row map lives only as long as the part
