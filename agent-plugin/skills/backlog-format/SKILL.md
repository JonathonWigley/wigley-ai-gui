---
name: backlog-format
description: "The follow-up file format the Auri app's Backlog reads and edits: where follow-up files live, the sections and list shapes, the item line with its tags, done items, images and the source-session line, and the Backlog assistant's two tools. Use when writing, rewriting, tagging or removing a follow-up, when acting as the Backlog assistant, or when a follow-up does not show in Backlog."
---

**Contents**

- **Intent** — one file shape that Backlog, the docs index and every agent read alike.
- **Where the files are** — features folders, the follow-ups file and the area folder, from a plugin's `auri.json`.
- **The two shapes** — a sections file with a Contents list, or a list file.
- **The item line** — the bold title, the tags span and the one line.
- **Tags** — how tags are read, and the tags the app offers.
- **Done items** — struck through or marked `shipped`.
- **The body** — what a section holds so it stands as a task brief, images and the source-session line.
- **The Backlog assistant** — `read_backlog_state` and `set_backlog_chunks`.

## Intent

A **follow-up** is a piece of work put off for later, written so an agent can pick it up cold. Backlog mode lists the
follow-ups of every repo on the machine in one table, judges which are stale, and starts chunks of them as sessions.
Backlog parses each file itself and writes edits back in the file's own shape, so a follow-up written in this shape
shows in Backlog at once, and one written in any other shape is lost to it.

## Where the files are

The backlog strategy picked in Settings (`backlog.strategy`) comes from an agent plugin's `auri.json` `backlog`
section. It names:

- `homes` — folder templates for a repo's **features folder**, in order. `{repo}` is the repo's clone root and
  `{name}` its origin repo name. The first that exists is the features folder.
- `file` — the follow-ups file in a features folder, such as `followups.md`.
- `areaFolder` — optional: a folder in a features folder holding one follow-ups file per area, such as `followups/`.

With no backlog strategy, Backlog lists nothing. Read the plugin's `auri.json` to find the paths before writing a
follow-up.

## The two shapes

A follow-ups file takes one of two shapes. Keep the shape the file already has.

- **Sections file** — a `**Contents**` list at the top, one line per follow-up, then one `## <title>` section per
  follow-up. The Contents line carries the item line (The item line). A file of `##` sections with no Contents list
  gets one, built from its headings, before an item is added.
- **List file** — one top-level `- ` item per follow-up, at column 0. The item's first line is the item line; the
  indented lines after it are its body.

A file counts as a sections file when it holds a `**Contents**` line, a `### ` heading, or a `## ` section with body
text and no top-level list item. Fenced code never counts.

## The item line

```markdown
- **<title>** — <one line>
- **<title>** — _agent-ready_: <one line>
- **<title>** — _agent-ready, <tag>_: <one line>
```

- The title is bold and unique in the repo: Backlog keys a row by repo and title, and an edit names its item by
  title. A title never starts with `~~`.
- The one line says what the work is, in plain words.
- In a sections file, the `## ` heading repeats the title.

## Tags

- Tags sit in one italic span (`*…*` or `_…_`) after the dash, comma-separated, closed by a colon.
- In a sections file the span is read from the Contents line only, never from the heading or the section.
- The app's `backlog.tags` setting lists the tags the notes popup offers; its default is `agent-ready` and
  `needs a feature plan`. Backlog's ready column shows `agent-ready`.
- Tag each item you write with the tags its plugin's rules define. Keep any other tag in a file as written: it is
  the user's own.

## Done items

An item is done when its title is struck through (`~~**<title>**~~`) or its one line starts with `shipped`. Backlog
hides done items until the user shows them. Remove an item whose work is done, unless the file's own convention
keeps done items struck through.

## The body

The section, or a list item's indented continuation, stands on its own as a task brief: the implementer reads only
it, with what it links.

- State every decision already settled, so the implementer finds it there.
- Images live in the features folder's `followups-images/<folder>/<n>.png`, linked from the body as `![<n>](<path>)` with the
  path relative to the follow-ups file. Only a link into a direct subfolder of `<features folder>/followups-images/` counts.
- A `Source session: <harness> <session id> in <folder>` line names the session the item came from, `<harness>`
  being `Claude Code` or `Codex`.

## The Backlog assistant

Backlog runs one scoped agent, the Backlog assistant, which makes every edit to a follow-up file on the user's ask.
Two tools answer only that session; any other session gets the error `<tool> answers only the Backlog assistant
session.`

- The `auri` server's `read_backlog_state` tool returns what the user sees in Backlog, which the assistant cannot
  see: the cursor item's full text and staleness, the marked rows, the filters, the chunks, and every open row by
  repo. Call it before acting on the cursor, the marks or the filters.
- The `auri` server's `set_backlog_chunks` tool replaces one repo's unstarted chunks with a `{ name, titles }` list.
  Pass every chunk the repo keeps. A chunk passed under its current name keeps its headless flag, and a started chunk
  cannot change. A refusal reads `Refused: <reason>`.

The assistant edits the files directly, in their own shape, commits each change and merges or pushes it as that repo's own rules say, and reports
each change by repo and title.
