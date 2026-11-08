# Session stash

**Contents**

- **Intent** — why a stash exists beside a plain close.
- **Behaviour** — the key, the note dialog, what main records and when, and where stashes list.
- **Decisions** — the choices a later change would otherwise reopen.

## Intent

The user parks a session to come back to it later, with a word on why, and wants the side bar to hold only the
sessions in play. A stash closes the session and keeps it one pick away at the top of the start prompt, with its note
beside its title, until the user resumes or archives it. The `session-stash` plugin owns all of it; chat and sessions
know nothing of it.

## Behaviour

- **The key.** `session-stash.stash` (`Space '`, scope `any`, beside `Space ;` close) acts on the focused pane's
  session while Sessions mode shows, the session sessions' close and rename keys act on, through the sessions page
  export `shownSessionId`. With no such session it logs `stash ignored: no session shows` and opens nothing.
- **The note dialog.** `Stash session`, the session's name as its side-bar row shows it, then a one-line note box,
  drawn through the plugin's `noteDialog` layout part (`src/plugins/session-stash/layouts/layout.d.ts`). Enter
  stashes, the note trimmed and an empty one meaning no note; Esc cancels and changes nothing, as the base scope
  changing under the dialog does.
- **The stash.** Enter closes the dialog and hands main `{ sessionId, note }` over the plugin's channel, so main holds
  the note before the close's event fires. It then awaits sessions' `closeSession`, the normal close: a session mid-turn
  asks chat's end-session confirm first. A close that does not land — the confirm answered no, a tab's `beforeClose` or a
  main close guard keeping the row — tells main to drop the note and logs `stash dropped: <name> stayed open`.
- **Only sessions the app started.** Main refuses a session chat does not own (`chat.profileOf` is null, such as a
  terminal row): the page toasts `Only sessions the app started can be stashed`, logs it, and leaves the row open.
- **What main records.** Main keeps each asked stash in memory, by session id, until that session's
  `chat.sessionClosed`:
  - reason `user` and `sent`: it writes the record — host session id, folder, profile, title (the side-bar title,
    `Untitled session` for none), note, time — to `stashed.json` in its plugin data, and logs `stashed "<title>"`;
  - reason `user` and never sent a message: it records nothing, since such a session cannot be resumed, and logs that
    it closed without a stash;
  - any other reason: it drops the asked stash.

  A message sent while the confirm is open changes nothing: only the close's outcome decides, so ending the session
  still stashes it and keeping it drops the note.
- **Where it lists.** The Stashed resume section, registered through chat's `addResumeSection`, at the top of the
  start prompt's Folder step and, filtered to the folder and profile, its Session step. Every stash lists, uncapped,
  oldest first, so the newest sits next to the cursor; one chat holds open or archived does not list. Chat asks the
  sections one at a time in registration order, and a later section's `isResumable` is false for a session an
  earlier one listed, so a stashed session shows under Stashed only, and Recently closed's cap counts only the
  sessions it shows. The row's detail starts with the note: `title · note · folder ·
  profile · time` on the Folder step, `title · note · time` on the Session step; the `/` filter matches the note.
- **Leaving the list.** Resuming the session (`chat.sessionOpened` with origin `resumed`) removes its record. `x` in
  the start prompt archives it, which hides it from every section. A second stash of one session replaces its record.
- **A bad file.** A `stashed.json` that is not a JSON array of records is the user's state: the section fails (chat
  logs it and leaves the section out), and a stash or a removal is refused and logged, leaving the file as it is.

## Decisions

- **Its own plugin.** Stashing can be swapped or disabled alone, and chat and sessions gain only generic seams: the
  optional `note` on `ResumeSectionRow` and sessions' `shownSessionId`.
- **Above Recently closed.** A stash is a deliberate park, so it is the first list the user sees. Chat orders sections
  by registration, so `session-stash`'s main part starts before `session-log`'s (`src/plugins/main.ts`).
- **The record is written at the close, not at the key.** The confirm mid-turn can be turned down, and only the close
  event carries the titles and `sent` the record needs. Sessions' `closeSession` resolves to whether the row closed, so
  the page learns a kept close and drops the note; main cannot tell a declined confirm from a close still waiting. The asked stash lives in memory only: a quit between the key
  and the close loses it, and nothing half-written is left on disk.
- **The normal close.** Stashing reuses `closeSession`, so every close guard and chat's confirm apply unchanged.
- **No un-stash key.** Archiving with `x` in the start prompt already hides a stash, and resuming removes it.
- **The note in the detail, not the title.** The resume opens under the plain title, and a layout's `title` stays the
  session's name.
