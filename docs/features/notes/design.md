# Notes popup — settled design

**Contents**

- **Intent** — what the popup is for.
- **The popup** — modal dialog, the one kept draft, its fields and keys.
- **Images** — paste, drop, GUI capture, markup.
- **Session reference** — the chip and the line it writes.
- **Destinations** — new follow-up, append to a follow-up, new session.
- **Seams** — window capture, the image encoder, the markup adapter, Backlog's and chat's exports, the docs binary write.

The decisions the user settled in the 2026-10-26 interview (two rounds and the agent's Decided notices), kept so the
plan is written from them. A decision here stands unless the user changes it.

## Intent

The user notes a nitpick while working — in the GUI or in a skill — and hands it to another agent without adding
context to the session in front of them. The note goes to a follow-up for later, or straight into a new background
session.

## The popup

- The `notes` plugin (main and page parts) shows a modal dialog (`createDialog`) over any mode. `Space n n` opens it;
  leader group `n` is notes. There is no global shortcut.
- It holds one draft. Closing keeps the draft; sending or discarding it starts a fresh one. The draft, its images and
  their markup are kept in the plugin's data folder, so a reload or restart keeps them.
- Rows, top to bottom: Target (a repo), Title, Body (a vim box), Tags (from Backlog's tag setting), the image strip
  and the Session chip. The follow-up's one line is the body's first sentence. The title is required for a new follow-up
  and optional for an append and for a launched session.
- Target defaults to the repo of the attached session's folder. A fuzzy picker lists every repo with a features home.
  A launched session starts in the target home's clone. For a home outside its clone it starts in the attached
  session's folder, else an open session row's folder, that maps to the target repo; with none, the send is refused
  with `No folder for <repo>; attach a session in that repo`.
- The `Space n` actions work from the body box in its normal mode only; in insert mode `Space` types a space, so
  `Esc` comes first. `Cmd+Enter` still sends a new follow-up.
- While a send, discard, capture, attach or image removal is in flight, no other of them starts and no picker,
  autosave or box focus does; text typed in a box already focused still lands and is saved when it ends.
- When a send or clear succeeds but writing the fresh `draft.json` fails, the popup shows a fresh note while disk
  keeps the sent draft, so after a restart the sent note comes back and could be sent twice. This is a deliberate
  trade (`draft-store.ts` `clear`).

## Images

- In: paste from the clipboard, drop a file, or capture the GUI. A file that is not an image goes into the Body as a
  file chip, its path (`docs/features/file-drop/design.md`); when the popup closed, or a send, discard, capture or image
  removal began, while a pasted file saved, its path is toasted instead. Capture hides the popup, grabs the window in main,
  and reopens the popup with the image attached, so the capture shows the app as the user saw it. Capture waits two
  frames after the hide, so the popup is gone from the shot.
- Each image opens a markup editor inside the popup: select and move, pen, text, arrow, box, four colours, undo and
  redo, each on a key. The colours are plugin theme tokens. While a text is being typed, every key without Ctrl, Alt
  or Cmd goes to the text, and Escape ends the edit before a second Escape leaves the markup. Markup stays editable until the note is sent; sending flattens each
  image to a PNG.
- Fabric.js (MIT) draws the markup, behind a markup adapter that is the only `fabric` import.

## Session reference

- The selected session attaches as a removable chip: harness, host session id, folder. A key picks another open
  session row instead.
- It writes one line into the follow-up or the launched message:
  `Source session: <harness> <session id> in <folder>`, so an agent can find the transcript by id. The harness is
  `Claude Code` or `Codex`, the folder is shown with `~`, and a part the session lacks is left out.

## Destinations

- **New follow-up** — one item in the target repo's create-target home, through Backlog. Images save as
  `followups-images/<folder>/<n>.png` in the home, where `<folder>` is fixed when the item first gets an image (its
  write time in UTC as `yyyyMMdd-HHmmss` and the title slug), and the body links each image after the text as
  `![<n>](<path>)`, one per line, `<path>` relative to the follow-ups file.
- **Append to a follow-up** — the fuzzy picker lists the target home's open follow-ups; the note's title, body and
  session line, then its image links, append to that item's body. The append carries the item as it read it, so a hand edit
  to the item meanwhile is refused (`<title> changed on disk; send again`) and the draft is kept.
- **New session** — chat starts a session in the folder the target resolves to (see The popup), under the attached session's profile when chat owns
  that session, else chat's first profile. Its first message is the brief from the `notes.launchBrief` setting
  (default `A nitpick to fix, noted while working. Make the change, then report.`), then the note's title, body and
  session line, with the images attached under chat's per-image cap (5 MB of base64 text), which every image meets when it is sent: the popup
  shrinks a pasted or dropped one over it when it joins the strip, and main shrinks every image again as it sends it to
  the session, a GUI capture and a flattened markup image included. A follow-up files its images at full size. An image that will not shrink under the cap refuses the send with
  `Image could not be shrunk under 5 MB`, and the draft is kept. The user stays where they were; the session runs
  in the background and a toast reads `Session started in <folder>`.

## Seams

- **Window capture** — a `capture` call on the existing `window` main service, returning the window's PNG at device pixels; the
  composition root fills it from Electron's `capturePage`, and tests hand the plugin a fake.
- **Image encoder** — the `images` main service (`ImageEncoder`, `src/contracts/images.ts`) the sender shrinks through;
  the composition root fills it from Electron's `nativeImage` (`src/main/images/`), and tests hand the sender a fake.
- **Markup** — a page service behind a contract (`MarkupEditor`, `src/contracts/markup.ts`); the Fabric adapter sits
  in `src/renderer/fabric/`.
- **Backlog** — owns every follow-up write and the `followups-images/` folder. Its main part exports `load` (the
  homes), `tags` and `fileNote`, which writes the follow-up and saves the images with it, and trashes them again when
  the write is refused or fails. Its delete trashes the image folders the deleted item links, and
  its commit takes the changed images under `followups-images/` with the follow-up files.
- **Docs** — its main exports gain `writeBytes` (a guarded binary write, so images pass the same write guard as
  text) and `trashDoc`.
- **Chat** — its main part exports `launch` (start a session and send its first message, without selecting the row),
  `profileNames` and `profileOf` (the profile of a session chat owns).
