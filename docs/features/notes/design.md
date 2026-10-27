# Notes popup — settled design

**Contents**

- **Intent** — what the popup is for.
- **The popup** — modal dialog, the one kept draft, its fields and keys.
- **Images** — paste, drop, GUI capture, markup.
- **Session reference** — the chip and the line it writes.
- **Destinations** — new follow-up, append to a follow-up, new session.
- **Seams** — window capture, the markup adapter, Backlog's and chat's exports, the docs binary write.

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
- Fields: Target (a repo), Title, Body (a vim box) and Tags (from Backlog's tag setting). The follow-up's one line is
  the body's first sentence. The title is required for a follow-up and optional for a launched session.
- Target defaults to the repo of the attached session's folder. A fuzzy picker lists every repo with a features home.
  The target is also the launched session's folder.

## Images

- In: paste from the clipboard, drop a file, or capture the GUI. Capture hides the popup, grabs the window in main,
  and reopens the popup with the image attached, so the capture shows the app as the user saw it.
- Each image opens a markup editor inside the popup: pen, text, arrow, box, a few colours, undo and redo, each on a
  key. The colours are plugin theme tokens. Markup stays editable until the note is sent; sending flattens each
  image to a PNG.
- Fabric.js (MIT) draws the markup, behind a markup adapter that is the only `fabric` import.

## Session reference

- The selected session attaches as a removable chip: harness, host session id, folder. A key picks another open
  session row instead.
- It writes one line into the follow-up or the launched message:
  `Source session: Claude Code <session id> in <folder>`, so an agent can find the transcript by id.

## Destinations

- **New follow-up** — one item in the target repo's create-target home, through Backlog. Images save as
  `followups-images/<folder>/<n>.png` in the home, where `<folder>` is fixed when the item first gets an image (its
  write time and title slug), and the body links each image by its path relative to the follow-ups file.
- **Append to a follow-up** — the fuzzy picker lists the target home's open follow-ups; the note's text, image links
  and session line append to that item's body.
- **New session** — chat starts a session in the target folder, under the attached session's profile when chat owns
  that session, else chat's first profile. Its first message is the brief from the `notes.launchBrief` setting
  (default `A nitpick to fix, noted while working. Make the change, then report.`), then the note's text and session
  line, with the images attached under chat's 5 MB-per-image cap. The user stays where they were; the session runs
  in the background and a toast names it.

## Seams

- **Window capture** — a `capture` call on the existing `window` main service, returning the window's PNG; the
  composition root fills it from Electron's `capturePage`, and tests hand the plugin a fake.
- **Markup** — a page service behind a contract; the Fabric adapter sits in its own folder.
- **Backlog** — owns every follow-up write and the `followups-images/` folder. Its main part exports its homes and
  the follow-up write, and saves images with it. Its delete trashes the image folders the deleted item links, and
  its commit takes the changed images under `followups-images/` with the follow-up files.
- **Docs** — its main exports gain a guarded binary write, so images pass the same write guard as text.
- **Chat** — its main part exports a launch: start a session and send its first message, without selecting the
  row.
