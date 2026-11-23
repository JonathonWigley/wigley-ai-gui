---
name: visuals
description: 'Drawing a live visual or showing an image or video in an Auri reply or forms round — an html code block the app renders in a sandboxed frame, or a render, screenshot or recorded clip on disk shown by its path. Use when a UI mockup, a mock of a look decision, a systems flowchart or architecture diagram, a rendered image, a flow worth showing in motion, or any picture would explain better than prose, in a session the app started.'
---

**Contents**

- **What the app does** — where an html block and an image render, and the frame a visual runs in.
- **Images** — showing a PNG or JPG on disk by its absolute path, in markdown and inside a visual.
- **Videos** — a clip in place of a run of stills, whenever what the user should see moves.
- **Writing one** — the document's shape, the theme variables, sizing and interaction.
- **UI mockups** — a preview of how a screen will look.
- **Mocking a decision** — each option of a look question, from the real asset first.
- **Flowcharts** — a systems flow drawn as SVG.
- **Before sending** — the check that ends the work.

A **visual** is a whole HTML document in an ` ```html ` code block in the reply. The Auri app draws it in
place, live, in the user's theme. An **image** is a file on disk — a render, a screenshot, a capture still — that the
app shows in place from its absolute path, and a **video** is a recorded clip on disk shown the same way. A good
visual or image shows at a glance what prose would take a paragraph to say, and reads as part of the app.

## What the app does

- A block, an image or a video renders in chat replies, forms rounds, the primer and the docs browser's markdown
  files. A block renders once the closing fence arrives; the user sees a "drawing visual…" card until then.
- The frame is sandboxed: scripts run, but there is no network, no `fetch`, no popups, no forms that post, and no
  navigation. Everything the visual needs is inline — `<style>`, `<script>`, inline SVG, `data:` fonts — apart from
  local images and videos, which load by absolute path (Images, Videos).
- The frame takes the full height of its content. Its width is the reading width (about 76 characters, near 670 px),
  or the column's whole width when the visual is wide. A visual wider than its frame scrolls sideways inline. The
  user opens it full size with `v` on the focused chat entry or its expand control, and flips its width with its
  widen control or `w`.
- A click gives the visual the user's clicks and typing; `Esc` hands focus back to the app.
- A terminal session sees the block as code and an image as its markdown, so the reply still reads without them.

## Images

The app serves an image file to the page by its absolute path, so an image the agent wrote to disk reaches the user
with no copy of its bytes in the reply. Name the path; never transcribe an image into a `data:` URI. A hand-copied
base64 string runs to thousands of characters, and a slip in it draws a black square.

- **In markdown** — a chat reply, any markdown field of a forms round (a question's `context`, a finding's
  `finding`, a notice's `context`), a primer or a doc: `![Sign-in screen](/abs/path/SignIn.png)`. Images on one line
  sit side by side. A path with a space goes in angle brackets, `![alt](</abs/my renders/a.png>)`.
- **Inside a visual** — `<img src="/abs/path/SignIn.png">`, or the same path in a CSS `url()`. Use it when the
  images need a layout markdown cannot give: screens with arrows between them, renders under labels, before and
  after side by side, a pin over one part of a screen.
- The path is absolute, with `/` separators (on Windows, `/C:/Users/…`), and names a png, jpg, jpeg, gif, webp or
  svg file, with `~` expanded to the home folder. A relative path or another file type shows as text in markdown,
  and as a broken image inside a visual.
- The app reads the file each time the image draws, so it shows only while the file is there: a scratchpad file
  serves while the session runs, and a render the user will come back to goes somewhere it stays.
- In a session the app did not start, the user sees the markdown or the `<img>` tag as text: name the path and say
  how to open the file.

## Videos

What moves — a flow across screens, a transition, an animation, a bug that shows over time — goes to the user as one
clip, never as a row of stills: the user judges motion by watching it. Stills stay for what holds still: one screen,
a before and after, a defect pinned on a screen.

- **Showing one** — the same as an image, by its absolute path: `![Save flow](/abs/path/save-flow.mp4)` in markdown,
  or `<video src="/abs/path/save-flow.mp4" autoplay muted loop controls>` inside a visual. In markdown the app plays
  it muted on a loop with its controls. The file is an `mp4` (H.264) or a `webm`; another type shows as text.
- **Where it comes from** — the recording the run already made: a playtest's recording, a drive run's video, or a
  screen recording. Make no new recording just to show one.
- **Trim it to the part that matters** — a few seconds around the flow or the bug, cut into the scratchpad:
  `ffmpeg -ss <start s> -to <end s> -i <in.mp4> -an -c:v libx264 -pix_fmt yuv420p -movflags +faststart <out.mp4>`.
  `-ss` and `-to` are the clip's start and end in seconds into the file; `-an` drops audio; `libx264` with `yuv420p`
  re-encodes to the H.264 the app plays; `+faststart` puts the index first so it starts at once. Scale a capture
  wider than about 1280 px down with `-vf scale=1280:-2`.
- **Name what to watch** — the prose beside the clip says what it shows and where to look ("the scrim appears at
  0:02, behind the save dialog"), so the reply reads without playing it.

## Writing one

- Write one complete document per block: `<!doctype html>`, `<html>`, `<head>` with a `<style>`, and `<body>`. One
  block per visual.
- Colour, type and borders come from the app's theme variables, so the visual matches every theme. Each is
  `var(--wg-<token>)`, set on `:root` just after the document loads. CSS picks them up live; a script that reads a
  theme colour reads it on a user action, since at start-up the variables are not set yet:
  - text: `fg`, `fg-secondary`, `fg-tertiary`, `fg-link`, `fg-on-accent`
  - surfaces: `transcript-background`, `card-background`, `block-background`, `input-background`
  - lines: `border-subtle`, `border-default`, `border-strong`, `card-border`
  - accent and states: `accent`, `accent-tint`, `status-success`, `status-warning`, `status-error`, `status-info`,
    `status-running`
  - type: `font-ui`, `font-mono`, `text-13` (body size), `weight-semibold`
  - shape: `radius-sm`, `radius-md`
- Set `body { margin: 0; background: transparent; color: var(--wg-fg); font-family: var(--wg-font-ui); }`, so the
  visual sits on the transcript.
- Size to the content: let the body grow, and give fixed widths only to what models a fixed screen, such as a phone
  frame. Give each local image a width, so the layout holds before the image loads.
- Mark a visual that needs more than the reading width with `<meta name="visual-width" content="wide">` in its
  `<head>`: a desktop window, panes side by side, a flowchart with more than three nodes across, a wide table.
- Give the document its height from its content: a height tied to the viewport (`vh` units, `height: 100%` on `html`
  or `body`) measures zero and shows nothing.
- Keep scripts small and self-contained: a tab switch, a hover detail, a toggle.

## UI mockups

A mockup previews how a screen will look before it is built.

- Draw the screen at its real proportions in a device or window frame: about 390×844 for a phone, a bordered box for
  a panel or dialog.
- Use real copy and plausible data, never lorem ipsum.
- When the screen already exists, open the code or capture that draws it first, and copy its layout, colours, sizes
  and text as they are today; change only the parts the user asked about. A capture of it on disk can sit beside the
  mockup as the before.
- When the screen is for this app, draw it in the theme variables above.
- Show the states that matter side by side (empty, loaded, error) or behind a small tab script.

## Mocking a decision

A question about a look (`forms` skill, Questions) shows each option as the user would see it in the product. Per
option, take the first route that fits:

1. **The real asset, changed and captured.** When the option changes an existing asset and the project has tooling
   that renders or captures it, apply the option, capture it, and put the asset back.
2. **A capture of the asset, drawn over.** When applying the option would take real work — new art, code not yet
   written — capture the asset as it is and draw the option over the capture in a visual: the capture by its path
   underneath, the change on top.
3. **An html mockup.** When no asset exists yet, or capturing it would cost more than the question is worth, draw
   the option as a mockup (UI mockups).

Caption each mock with its option's number and whether it is a render, a drawing over a capture or a mockup.

## Flowcharts

A flowchart shows how a system moves: components, the calls between them, and the order.

- Draw it as one inline `<svg>` with a `viewBox`, so it scales to the frame's width.
- Lay out on a grid: nodes in rows or columns by stage, edges as straight or right-angled paths that never cross a
  node. Read top to bottom or left to right.
- A node is a rounded `rect` with a short label; colour marks its kind, with a small legend when there are more than
  two kinds.
- An edge is a `path` with an arrowhead `marker`, labelled at its midpoint with what crosses it.
- Colour the SVG through CSS classes in the `<style>` (`.node { fill: var(--wg-card-background); stroke:
  var(--wg-border-strong); }`), never through `fill` or `stroke` attributes: an attribute does not resolve `var()`.

## Before sending

The visual or image is done when:

- the document is complete, from doctype to `</html>`, inside one closed html fence
- every image and video is named by an absolute path to a file that exists, with no `data:` copy of a file on disk
- anything that moves is a clip, not a sequence of stills
- it names no URL outside the document and the local files: no network `src` or `href`, no `@import`, no web font
- every colour is a theme variable, except inside a mockup of a screen with its own fixed palette
- the prose around it says what it shows, so the reply reads without it
