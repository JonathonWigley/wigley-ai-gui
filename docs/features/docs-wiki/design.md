# Docs wiki — settled design

**Contents**

- **Aim** — what the wiki is for, and what it stays clear of.
- **Main page and sidebar** — the one file both come from, its format, and the `wiki:` links.
- **Page** — the article, its header, the right column and narrow windows.
- **Section editing** — what a section is, the editor in place, saving and conflicts.
- **Links** — which references become links, how targets resolve, and Linked from.
- **Search** — what the sidebar filter finds in each view.
- **Recent changes** — where the list comes from.
- **Session Docs tabs** — what changes there.
- **Keys** — the binds the wiki adds.
- **Out of scope** — what stays out, and why.

The decisions the user settled in the 2026-11-05 interview, from mockups, kept so the plan is written
from them. A decision here stands unless the user changes it. This doc extends
`../docs-browser/design.md`, which still holds for what is not named here.

## Aim

Docs mode reads as a wiki over the user's own agent docs, so the docs the user edits most are the
easiest to reach and to change. The user gave the order of importance: rules, then workflow, then
everything else. The user's workflow will change, so the app holds no knowledge of a workflow: no
pipeline, no stages, and no fixed shelf names. Every shelf comes from a file the user edits.

## Main page and sidebar

- `~/wigley-agents/wiki/Main.md` is one file with two views: it renders as the Main page, and the
  sidebar is built from its headings and links. One file keeps one list of pages, and it reaches
  every machine with the user's other agent docs.
- Format: each `##` heading is a shelf, each `###` heading is a label inside the shelf, and each
  markdown link under them is a page. The link text is the page's title. Anything else in the file
  renders on the Main page and stays out of the sidebar.
- Link targets are a path (`~/` or relative to `Main.md`), a skill (`wigley:<name>`), or a `wiki:`
  link. A link the index does not list shows dimmed and refuses with the toast `Not in the docs index: <title>`.
  A `wiki:` or `wigley:` link in a rendered body opens its target as its sidebar row does.
- `wiki:kind/<kind>` opens a generated list page of the user's own docs of that kind, grouped by
  repo, and its sidebar row shows the count. `wiki:owner/third-party` does the same for third-party
  docs. A list page groups by repo, and the third-party list by plugin, with `Global` holding a doc that
  has none. `wiki:all` switches the sidebar to All pages. They are links in the file, so the user can
  move or drop any of them.
- The index walks `~/wigley-agents/wiki/` and lists its files with the `reference` kind. A file at
  the folder's top level would index as instructions.
- All pages is the existing tree, unchanged: stars, create, rename and trash stay there. The tree's
  create, rename and trash keys also act on the sidebar's page rows. The Starred group stays in All
  pages, since the Main page is the curated list.
- Only the machine view, Docs mode, holds the wiki. `s` on a wiki row toasts `Stars stay in All pages`.
- Docs mode opens on the Main page at each app start. Leaving and returning keeps the page shown, as
  every mode does. With no `Main.md`, the page shows an empty state that offers to create it.

## Page

- The title comes first, with the filename under it. The Claude and Codex load chips, the plugin
  source statuses and the Loaded time stay under the title.
- A right column holds On this page (the doc's headings) and Linked from. It belongs to the docs
  page, since the shell's right bar spans every mode. It hides when the page's container is narrower
  than 950px, before the article gives up any width.
- Back and forward arrows sit in the page's top row (`div.docs-history`), each hiding at its end of the history. The Main
  page's `main` hint sits between them.
- A heading's `edit` control shows on hover and on focus. It takes no Tab, since `kit.button` sets
  `tabindex="-1"`: `e` is the key.
- A read-only doc, a hook or a plugin entry draws as today, with no section editing.
- A generated list page and the Main page draw through the same page frame.
- Everything new draws through the docs layout, so the user restyles or moves any of it, Recent
  changes included, by editing a layout file.

## Section editing

- A section is a heading and everything under it, up to the next heading of the same or higher
  level. Fenced code holds no headings.
- `e`, or a section's `edit` control, opens that section's text in the document editor, in place.
  The rest of the page stays rendered around it. The section's rendered blocks hide rather than the
  doc rendering in pieces, so heading anchors stay unique.
- `:w` splices the section into the file's text and writes the whole file. `:q`, `:wq`, `:q!` and Esc
  act as they do in the whole-file editor.
- A disk change during a section edit takes the existing flow: the banner, then reload or overwrite
  at `:w`. There is one conflict flow.
- `e` above the first heading opens the whole-file editor. A doc that is not markdown has no
  sections, and `e` toasts that.
- `i` keeps opening the whole file.

## Links

The index parses each doc once and stores its headings and outgoing links, so the page and Linked from
read one result. `scripts/check_pointers.py` holds the existing heading match, by longest prefix,
because a `§` target has no end delimiter and runs into prose.

- These become links: relative markdown links, `<file> § <Section>`, `wigley:<skill> § <Section>`, and
  a bare `§ <Section>` that matches a heading in the same file. A `›` names a subsection.
- A bare file name resolves only when one target is clear. It stays plain text otherwise, since
  `AGENTS.md` exists in many repos. No link is a guess.
- A link to the shown doc's own file moves within it and reads nothing, so an open section editor stays.
- Linked from is a reverse lookup over the loaded entries, in the page. Clones of one repo show once.
  A link inside a follow-up file has no entry of its own, so it never appears under Linked from.
- Links refresh on each index build, so they can lag a save until the next build.

## Search

The sidebar filter finds page titles, filenames and section headings. In the wiki view it covers the
user's own docs. In All pages it also covers third-party docs. Body text stays out, since the index
holds none.

## Recent changes

The Main page ends with the latest commits touching the pages `Main.md` links to, one row per commit,
newest first. `docs.recentChangesLimit` caps the rows and defaults to 10. The history comes from the
`Git` log call, since the app runs `git` only through that adapter.

## Session Docs tabs

A session's Docs tab keeps its tree of the docs that session loaded, because that is the tab's purpose.
It gains the new article page, section editing, links and back and forward through the shared view.
It holds no wiki: `Space v w` toasts `A session's Docs tab keeps its own tree`, and `gh` shows the
Main page in Docs mode. Its right column usually stays folded, since the tab is narrow.

## Keys

- `e` edits the section the view is in.
- `Ctrl+h` and `Ctrl+l` move to the previous and next section, the app's keys for previous and next unit.
- `Ctrl+o` and `Ctrl+i` go back and forward, as vim's jump list does, while the page has focus. Each docs view has its own history.
- `gh` opens the Main page, from the docs tree or the page.
- `l` and `Enter` on the page open the cursor row of a list page, and otherwise follow the focused link or press the
  focused button.
- `Space v w` switches the sidebar between the wiki and All pages, and a control at its top does the
  same by mouse.

## Out of scope

- Full-text search, and the fuzzy finders already in `../followups.md`.
- Attention lists, meters and any other dashboard part. The user asked for a wiki.
- A saved position across app starts.
