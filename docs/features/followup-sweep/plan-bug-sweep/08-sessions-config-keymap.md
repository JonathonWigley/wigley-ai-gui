# 08 — Sessions' drive map drops ended sessions, ConfigStore stops on dispose, `<` refused as leader

Status: not started
Type: Batch
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     modify `src/plugins/sessions/main/start.ts` · test `src/plugins/sessions/main/start.test.ts` ·
           modify `src/main/config/config-store.ts` · test `src/main/config/config-store.test.ts` ·
           modify `src/main/config/user-keymap.ts` · test `src/main/config/user-keymap.test.ts`
Consumes:  `SessionsMainEvents` and `QualifiedEvents` (in the tree)
Produces:  `export function addDriveActions(host: DriveHost, sessions: Pick<SessionsMainExports, 'connect' | 'activate'>, onSessionEnded: (listener: (rowId: string) => void) => void): Disposable` in `src/plugins/sessions/main/start.ts`
Decisions: sessions' drive `connected` map drops an entry on `sessions.ended`; `ConfigStore.dispose` sets
           `isDisposed`, and a running rebuild then neither publishes nor loops; `readLeader` refuses a leader that
           resolves to `<` (plan.md, Decided notices)

## (a) Sessions' drive `connected` map

- `addDriveActions` in `src/plugins/sessions/main/start.ts` takes a required third parameter
  `onSessionEnded: (listener: (rowId: string) => void) => void`, as forms' `addDriveActions` does. At the top it
  registers a listener that deletes the `connected` entry whose `session.session.id === rowId` (the map is keyed by
  the caller's `sessionId`; the row id is the value's `session.id`). Its doc comment gains forms' sentence:
  `onSessionEnded` hears each session that ends, by its row id.
- **How sessions hears its own event — through the bus.** `SessionsApi` gains a fourth type argument,
  `QualifiedEvents<'sessions', SessionsMainEvents>`, as chat, docs and forms declare it, and `sessionsMainPart.start`
  passes `(listener) => api.events.on('sessions.ended', ({ sessionId }) => listener(sessionId))`. Why the bus and not
  a callback out of `createList`: every way a session ends (its relay gone, the agent ending, the drive's `end`; closing
  a row emits `closed`, not `ended`, and leaves the session connected) reaches the one `deps.emit('ended', …)` in `session-list.ts`, which already publishes on the bus, so
  the drive actions hear exactly what forms, chat and docs hear, and the same `addDriveActions` signature serves
  forms and sessions. A local fan-out in `createList` would be a second path for one event. No plugin hears its own
  event today; `npm run typecheck` confirms the widened `Heard` type, and nothing in the bus refuses a plugin hearing
  its own id (task 06's wrapper logs a throw from it like any other).
- The drive's own `end` deletes its entry before `session.end()` emits, so its listener call finds nothing.
  `dispose` ends each still-connected session, and each end's synchronous `ended` deletes that entry while the loop
  iterates `connected.values()`; a `Map` iteration tolerates deleting the current entry, and `connected.clear()`
  follows. Keep that order.

GIVEN a drive session `a` connected WHEN its row ends outside the drive's `end` THEN `connect { sessionId: 'a' }`
connects a fresh session and `dispose` does not end the first one again

Tests (`src/plugins/sessions/main/start.test.ts`, sentence names as the file uses):

- Copy forms' `fakeEndedEvent()` (`src/plugins/forms/main/start.test.ts`) into this file, nested beside
  `fakeSessions()`; the five existing `addDriveActions(drive.host, sessions)` calls pass `ended.on` (or a no-op) as
  the third argument.
- `a session that ends outside end leaves the map, so its id connects again` — connect `{ sessionId: 'a' }`,
  `ended.emit('row-a')`, then `drive.run('connect', { sessionId: 'a' })` resolves to
  `{ sessionId: 'a', rowId: 'row-a' }`; after `actions.dispose()`, `sessions.ended` equals `['row-a']` (only the
  second connection, ended once by dispose).

## (b) `ConfigStore` after dispose

- `loadConfigStore` gains `let isDisposed = false`, set to `true` in `dispose()` beside closing the watch and
  clearing the listeners (the `isClosed` flag in `src/main/ui-state/ui-state-file.ts` is the shape).
- `requestRebuild`'s loop: the config `await rebuild(false)` returns is published only while `!isDisposed`, and the
  `do … while` condition becomes `isQueued && !isDisposed`. `running = null` still runs after the loop. A rebuild
  that throws after dispose still logs `config not read: …` as today.
- The `ConfigStore` comment's `` `dispose` stops watching the folder and drops every listener; `current` keeps
  returning the last config. `` adds that a rebuild already running when `dispose` is called publishes nothing and
  runs no further rebuild.

GIVEN a rebuild held mid-read with a second change queued WHEN `dispose` runs and the reads are released THEN
`current()` still returns the config from before the change and no second rebuild reads `settings.json`

Test (`config-store.test.ts`, sentence names): `a rebuild running at dispose publishes nothing and runs no more` —
modelled on `runs one more rebuild for changes during a rebuild, serving the latest file`: `load(held.files)` over
`heldReads(memory)`; note `width = store.current().settings.window.width` and the `settings.json` read count;
`held.hold()`; write `'{"window":{"width":1000}}'` then `'{"window":{"width":1100}}'` to
`` `${FOLDER}/settings.json` `` (the first starts a rebuild, the second queues one); `store.dispose()`;
`held.release()`; `await new Promise((resolve) => setTimeout(resolve, 0))`. Then
`store.current().settings.window.width` is `width`, and the `settings.json` reads grew by exactly `1`. The two
assertions fail separately without each guard.

## (c) `readLeader` refuses `<`

- `readLeader` in `src/main/config/user-keymap.ts`: once the page key is resolved, a key that is `'<'` throws
  `new Error(LEADER_PROBLEM)` — fold it into the existing refusal as a named boolean (e.g. `isLessThan`), so `<` and
  `<lt>` are refused in one place. `LEADER_PROBLEM` is unchanged:
  `"leader" must be one key, such as "<Space>" or ",".`
- The comment above `readLeader` drops `` `<lt>` is `<` `` from its examples (keeping `` `<Bslash>` is `\` ``) and
  says `<` is refused, since a `<` leader would make `<Leader>a>` read as the named key `<a>`.

GIVEN `keymap.json` with `"leader": "<"` or `"leader": "<lt>"` WHEN it is parsed THEN it throws
`"leader" must be one key, such as "<Space>" or ",".`

Tests (`user-keymap.test.ts`, `Name_Case_Result` as its leader tests use):

- Remove the rows `['<lt>', '<']` and `['<', '<']` from the
  `parseUserKeymap_LeaderTypingOneCharacter_StoresTheCharacter (%s)` `it.each`.
- Add `it.each(['<', '<lt>'])('parseUserKeymap_LessThanLeader_Throws (%s)', …)` — `parse({ leader: written })`
  throws `'"leader" must be one key, such as "<Space>" or ",".'`, beside `parseUserKeymap_ChordLeader_Throws`.

Done when: `npm run typecheck` and `npm run lint` pass; the test gate runs the tests above
Commit:    one commit for the group

## Proof

## Live checks for task 15

- **Unreachable** — report it so in task 15: a drive session ends only through the drive's own `end` (which already
  drops the entry) or a relay going away, which a drive run cannot cause; closing a row emits `closed`, not `ended`.
  The unit test with the fake ended event carries the claim, and `npm run typecheck` carries the bus wiring's type.
