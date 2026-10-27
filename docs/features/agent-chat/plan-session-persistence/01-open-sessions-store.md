# 01 — Open-sessions store

Status: done
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:     create `src/plugins/chat/main/open-sessions.ts` · test `src/plugins/chat/main/open-sessions.test.ts`
Consumes:  `Files`, `readIfPresent` from `src/contracts/files.ts` (in the tree)
Produces:  in `src/plugins/chat/main/open-sessions.ts`:
           `export const OPEN_SESSIONS_FILE = 'open-sessions.json'`
           `export interface SavedSession { hostSessionId: string; projectDir: string; profile: string; sent: boolean; busy: boolean }`
           `export interface SavedSessions { sessions: SavedSession[]; selectedHostSessionId: string | null }`
           `export interface OpenSessions { load(): Promise<SavedSessions>; save(snapshot: SavedSessions): Promise<void> }`
           `export function createOpenSessions(data: Files): OpenSessions`
Decisions: same shape as `archived-sessions.ts` (design review) · an unreadable file is never overwritten (design
           review) · whole-snapshot writes: chat holds the state, the store writes what it is handed

Behaviour:

- `load()` resolves `{ sessions: [], selectedHostSessionId: null }` when the file is missing, the parsed snapshot
  when it is valid, and rejects with an error naming `open-sessions.json` when it is not JSON or not that shape
  (a missing field, a wrong field type, `sessions` not an array). The file is pretty-printed JSON, two-space indent,
  as `archived-sessions.json` is.
- After a `load()` that rejected, every `save()` rejects with an error naming the file as unreadable and writes
  nothing. A `save()` before any `load()` writes.
- `save()` calls run one after another (the `lastWrite` chain `archived-sessions.ts` uses), so the file ends holding
  the last snapshot handed in.

GIVEN a file holding `{"sessions": "x"}` WHEN `load` runs THEN it rejects naming `open-sessions.json`, and a later
`save` rejects and leaves the file's text as it was.

Tests:     `load_FileShape_ReadsOrRejects` — table: missing → empty snapshot; valid two-record file (general values:
           distinct ids, folders, profiles, `sent` and `busy` differing between rows, a selected id) → that snapshot;
           rows for not JSON, `sessions` not an array, a record missing `profile`, `busy` a string,
           `selectedHostSessionId` a number → rejects with a message containing `open-sessions.json`
           `save_AfterUnreadableLoad_WritesNothing` — the file's text is unchanged and `save` rejects
           `save_TwoCallsInARow_FileHoldsTheSecond` — two saves without awaiting the first; the file parses to the second
           Run them over the in-memory `Files` the `archived-sessions.test.ts` tests use.
Done when: compiles; the test gate runs the tests above
Commit:    one commit for the group

## Proof

Commit 54aff62 · proof: diff read: every Produces present in open-sessions.ts; typecheck clean; open-sessions.test.ts 9 cases pass · concerns: load_FileShape_ReadsOrRejects split into two it.each tables (snapshot rows, reject rows)
