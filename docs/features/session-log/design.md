# Session log

**Contents**

- **Intent** — why the log and the list exist.
- **Events** — what chat and sessions announce, and what the log records.
- **Recently closed** — which sessions list, and where they show.
- **Decisions** — the choices a later change would otherwise reopen.

## Intent

A session closed by accident has to be easy to find and reopen, and a later question about what happened to a session
("did the user close it, or did the relaunch?") has to have an answer on disk. The `session-log` plugin keeps an
append-only record of every session lifecycle change, and offers the closed sessions back in the start prompt.

## Events

Chat announces each lifecycle change of a session it owns on its event bus. Sessions announces terminal sessions.
`session-log` listens and records each one as a JSON line in `session-events.jsonl` in its plugin data. Any other plugin
can hear the same events.

| Log event | Source | When |
|---|---|---|
| `opened` | `chat.sessionOpened` | a session started, was resumed, was launched by a plugin, or was restored at app start (`origin`) |
| `closed` | `chat.sessionClosed` | a row ended, with `reason`: the user, a failed start, or `closeSessionsIn` |
| `cleared` | `chat.sessionCleared` | `/clear` moved a row to a new host id |
| `processEnded` | `chat.processEnded` | a process exited: stopped, clean or crash |
| `archived` | `chat.sessionArchived` | a saved session was archived or restored from the archive |
| `terminalConnected`, `terminalEnded` | `sessions.connected`, `sessions.ended` | a session the app did not start connected or ended |

Chat fires `sessionClosed` before it drops the row, because `sessions.closed` reaches a listener too late: closing a
resting row ends it inside the same call, so its titles are already gone, and `closeSessionsIn` never fires it.

A quit or relaunch is never a close. `session-log` stops before chat, and chat's stop does not run a close. The next
start logs each row as `opened` with origin `restored`.

## Recently closed

The start prompt asks chat for its resume sections, and `session-log` registers one, Recently closed, through chat's
`addResumeSection`. It shows at the top of the Folder step across every folder and profile, where a pick resumes at
once, and at the top of the Session step filtered to the chosen folder and profile. `recentlyClosedCount` caps it.

A session lists when the user closed it or cleared it, it was sent a message, and it is neither open nor archived. Each
session shows once, under the title it had in the side bar.

## Decisions

- **Its own plugin.** The log and the section can be swapped or disabled alone, and chat knows no log exists. Writing
  both in chat was smaller, and ties them to chat for good.
- **The cursor keeps its place.** `Space k n` then Enter still picks the most recent folder, and Enter on the Session
  step still starts a new session; Recently closed sits above the cursor, one `k` away.
- **The title from the side bar.** The session list's own titles are first messages, and recognising the session is
  the point of this list.
- **`/clear` lists.** The accident and the recovery match a close. Resuming a cleared conversation opens a new row
  beside the cleared one.
- **Terminal sessions log and never list.** The app does not know a terminal session's profile, so it cannot resume one.
- **The file is never trimmed.** A line is small and a close is a rare event, and old lines answer later questions.
