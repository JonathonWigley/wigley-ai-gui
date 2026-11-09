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
| `closed` | `chat.sessionClosed` | a row ended, with `reason`: the user, a failed start, `closeSessionsIn`, or a plugin's `close` (`finished`) |
| `cleared` | `chat.sessionCleared` | `/clear` moved a row to a new host id |
| `processEnded` | `chat.processEnded` | a live process exited: stopped, clean or crash (a closed or cleared row's process logs none) |
| `archived` | `chat.sessionArchived` | a saved session was archived or restored from the archive |
| `terminalConnected`, `terminalEnded` | `sessions.connected`, `sessions.ended` | a session the app did not start connected or ended |

A pool project's session fires `sessionOpened` when its claim lands, in the claimed clone; a row whose claim never
lands fires neither `sessionOpened` nor `sessionClosed`, so the log holds no line for it.

Chat fires `sessionClosed` before it drops the row, because `sessions.closed` reaches a listener too late: closing a
resting row ends it inside the same call, so its titles are already gone, and `closeSessionsIn` never fires it.

A quit or relaunch is never a close. `session-log` stops before chat, and chat's stop does not run a close. The next
start logs each row as `opened` with origin `restored`, except a row whose profile is no longer in chat's `profiles`
setting.

## Recently closed

The start prompt asks chat for its resume sections, and `session-log` registers one, Recently closed, through chat's
`addResumeSection`, below `session-stash`'s Stashed (`docs/features/session-stash/design.md`). It shows at the top of the Folder step across every folder and profile, where a pick resumes at
once, and at the top of the Session step filtered to the chosen folder and profile. `recentlyClosedCount` caps it, and
0 hides it. Chat asks Stashed first, and a stashed session is not resumable for Recently closed, so the cap counts
only the sessions Recently closed shows. The newest row sits last, next to the cursor, so `k` then Enter reopens the session closed last.

A session lists when the user closed it or cleared it, it was sent a message, and it is neither open nor archived. Each
session shows once, under the title it had in the side bar. It stays out until its process has ended, as a past session
does. The Session step lists it only when its transcript is found; the Folder step reads no transcripts, so a pick there
can fail with the resume toast.

## Decisions

- **Its own plugin.** The log and the section can be swapped or disabled alone, and chat knows no log exists. Writing
  both in chat was smaller, and ties them to chat for good.
- **The cursor keeps its place.** `Space b n` then Enter still picks the most recent folder, and Enter on the Session
  step still starts a new session; Recently closed sits above the cursor, one `k` away.
- **The title from the side bar.** The session list's own titles are first messages, and recognising the session is
  the point of this list.
- **`/clear` lists.** The accident and the recovery match a close. Resuming a cleared conversation opens a new row
  beside the cleared one.
- **Terminal sessions log and never list.** The app does not know a terminal session's profile, so it cannot resume one.
- **The file is never trimmed.** A line is small and a close is a rare event, and old lines answer later questions.
- **A Folder step row spells only the folder's base.** Two folders with one base look alike. A full path in the row's
  label, which is also its filter text, was tried and dropped: a filter naming a parent path then put the cursor on a
  closed session, so Enter resumed it instead of opening the folder.
