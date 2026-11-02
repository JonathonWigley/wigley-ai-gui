# File drop — design

**Contents**

- **Intent** — paste and drop files into any text box in the app.
- **Words** — drop target, file chip, pasted file.
- **Routing** — which target a drop or a paste reaches.
- **What a file becomes** — per surface: Chat, the vim boxes, one-line inputs, the Docs editor, the Notes popup.
- **Pasted files** — files with no path on disk, and where they are saved.
- **Images over 5 MB** — shrunk to fit, never refused for size.
- **Seams** — the core drop registry, the bridge calls, the editor contract, the chip pattern.
- **Out of scope**

## Intent

The user pastes and drops files — images, videos, docs, folders — into whatever text box they are
working in, as Claude Code takes `[Image-1]`. A drop lands in the pane under the pointer when the
mouse is released, whatever that pane's focus or vim mode; a paste lands in the focused box. A
file goes in as its path, which the agent opens itself; Chat keeps sending images as images.

## Words

- **Drop target** — an element a plugin registers with the core, with what to do with files
  dropped or pasted on it. Targets nest: a Chat tab, and inside it nothing else; a settings row's
  input inside Settings mode.
- **File chip** — a file's path in a vim box's text, drawn as a pill holding a file icon and the
  file's name (`[VideoName.mp4]`). The text holds the full path, so the agent receives the plain
  path, and a draft or `setText` keeps the chip. A path with a space is written in double quotes
  (`"/Users/me/My File.md"`). Any absolute path in a box's text draws as a chip, typed or dropped.
  In vim a chip is one character: the cursor steps over it and `x` deletes it whole.
- **Pasted file** — a file with no path on disk: a screenshot on the clipboard, or an image
  dragged out of a browser. It is saved first, so it has a path.

## Routing

- **Drop**: the innermost registered target under the pointer takes the files. A drop on no
  target does nothing, and no drop ever opens the file in the window (the core cancels every
  file `dragover` and `drop` on the page).
- **Paste**: the innermost target holding the focused element takes it; with no focused
  element inside a target, the target that last held focus and is still on screen takes it.
  Paste with no files, or with text that is more than a file's name or one URL (spreadsheet and
  word-processor copies put a picture beside the text), stays a text paste.
- A target inserts at its box's cursor without moving focus or changing the vim mode.
- A pane's own target picks its box: the Chat composer; on a Form or Primer tab the box last
  used, else the first. A pane with no box shows the toast `Nothing here takes files`.

## What a file becomes

| Surface | Image | Other file or folder |
|---|---|---|
| Chat composer | attached image, thumbnail above the box (shrunk to fit) | file chip |
| Vim boxes (Form, Primer, Backlog editor, Notes body) | file chip | file chip |
| One-line inputs (settings rows, filters, dialogs) | plain path | plain path |
| Docs editor | `![name](path)`, path relative to the doc | `[name](path)`, path relative to the doc |
| Notes popup | its Images field, as today | file chip in its Body |

Several files insert in the order given, separated by spaces, with a space before the first when
the character before the cursor is not whitespace.

## Pasted files

- Saved by main under the app instance's data folder, `pasted/<yyyyMMdd-HHmmss>-<n>.<ext>`, the
  extension from the media type. Never deleted by the app. In the self-test and a drive run, the
  folder sits in the run's own home.
- In the Docs editor a pasted file is saved beside the doc instead, as
  `images/<doc name>-<yyyyMMdd-HHmmss>.<ext>`, through the docs write guard, so the picture
  travels with the doc.
- In Chat a pasted image attaches as an image, saving nothing.

## Images over 5 MB

The API caps one image at 5 MB of base64 text. An image over it is scaled down and re-encoded,
stepping down until it fits: JPEG and WebP re-encode as themselves at quality 0.9, PNG and GIF as
PNG (a GIF keeps its first frame). An image still over the cap after six steps is refused with a
toast. Chat shrinks an image when it is attached; the Notes popup shrinks one when it joins the Images field, so its send to a
session always fits.

## Seams

- **Core drop registry** (page core, `api.drops.addTarget`) — routes drop and paste as above. A
  target is an element and `take(files)`; registering returns a `Disposable`. A new surface adds
  a target, with no core edit.
- **Bridge** — `pathForFile(file)` reads a dropped file's path through Electron's
  `webUtils.getPathForFile` in the preload, the empty string for a file with no path;
  `savePasted(bytes, mediaType)` saves a pasted file in main and returns its path.
- **Editor contract** — `TextEditor.insert(text)` types `text` at the cursor, keeping focus and
  the vim mode. The CodeMirror adapter draws file chips in every box `create` makes; the document
  editor draws none.
- **Chip pattern** — a pure shared module finds the paths in a text and formats a path for
  insertion (quoting), on both OSes through `Paths`.

## Out of scope

- Dragging text between boxes: the editor's own behaviour stays.
- Dropping files on the Docs file tree to copy them into a folder.
