# Backlog mode — settled design

**Contents**

- **Scope** — what Backlog covers, what counts as wigley-written, and what stays out.
- **The mode** — the plugin, the page's panes, its scopes, settings and keys.
- **Follow-ups** — reading, watching, done items, images.
- **Tags** — where a tag lives, the settings list, and the ready column.
- **The table and filters** — the rows, the filters, the review pane, the empty table, the saved place.
- **Staleness** — the git signals, the named paths, the level rule, the cache.
- **Chunks** — the store, its rules, a start, the first message, the folder rule, retiring.
- **The assistant** — the global scoped agent, its pane, its tools, the sweep.
- **Seams** — docs' exports, the shared follow-up module, main's exports, the two parsers.

Backlog is the place the user reviews follow-ups across every repo, sees whether each is still true, groups them into
chunks of one session's work, and starts those sessions. Backlog reads and starts; every edit to a follow-up file
goes through the assistant, a chat beside the table. A decision here stands unless the user changes it.

## Scope

- Backlog shows the follow-ups the user's wigley workflows wrote, from every repo in one table.
- Wigley-written means a features home's follow-up files (`~/wigley-agents/AGENTS.md` § Features):
  `<home>/followups.md` and `<home>/followups/*.md`. A repo's own `docs/followups/*.md` is team-repo content and stays
  out, though the docs index lists it.
- Old files whose shape hid their items (the gui and harness follow-up files) were converted to the list shape.
  Backlog and the docs index read each file in its own shape.
- Out of scope: plans and primed features, chunking a follow-up at the time a skill writes it, and an agent-run
  staleness check per item.

## The mode

- The `backlog` plugin has a main part, a page part and a layout (`backlog.layout`). Main depends on `docs`, `chat`,
  `sessions` and `scoped-agents`; the page depends on `docs` and `scoped-agents` and reads `sessions`.
- The mode registers no side bar. `Space k b` shows Backlog; pressed again while Backlog shows, it does nothing.
  `Alt+h` at the table's left edge reaches no side bar.
- The page holds four panes. The table and the review pane sit side by side, the chunk strip under both, and the
  assistant pane at the end, at full height, hidden until `Space v b` shows it. The table pane holds its header, the
  filter bar, the filter box and the column head above its rows.

  ```
  [table: header · filter bar · / box · repo │ task │ ready │ staleness │ chunk] │ [review pane] │ [assistant pane]
  [chunk strip: chunk cards · New chunk                                         ]                │
  ```

  In a narrow window the assistant pane stacks under the Backlog area, as every split does when narrow, and the
  stacked Backlog area takes the larger share.

- The layout's parts: `table`, `filters`, `tableRow`, `empty` (kit scope `backlog.table`); `review`, `reviewItem`,
  `commits` (`backlog.review`); `strip`, `chunkCard`, `newChunk` (`backlog.strip`); `pickerRow` (`backlog.picker`).
  The assistant pane's ask box is scoped-agents' `askBox` part; Backlog's layout draws none of that pane.
- Scopes: `backlog.table` (the table), `backlog.review` (the review pane), `backlog.strip` (the chunk strip),
  `backlog.box` (the filter box or the chunk rename box, pushed while open; one at a time) and `backlog.picker` (the
  repo picker, pushed while open). The assistant pane's ask box is `scoped-agents.ask`
  (`docs/features/scoped-agents/design.md`); its mounted chat view holds chat's own scopes.
- Settings:
  - `tags`: kept for notes
  - `layout`: the layout's name
  - `launchBrief`: the text a chunk's first message opens with. Its default, verbatim: `Work these follow-ups in this
    session. First check each one against the code as it is now: remove an item whose work has landed, and rewrite an
    item the code has moved past. Then work the rest under your workflow, and report what you did with each item.`
  - `repoFolders`: a list of `{ "repo": "<repo>", "folder": "<folder>" }`, default `[]`; the folder a repo whose
    features home is outside the repo starts sessions in and resolves named paths against (§ Chunks, Folder rule). A
    change reloads the page.
- Keys, all checked against `docs/keymap.md` and `src/plugins/keymap.ts`:

  | Key | Scope | Action |
  |---|---|---|
  | `Space k b` | any | show Backlog |
  | `j` `k` `gg` `G` | table, review pane | move a row; in the review pane, scroll a line, or to the top or end |
  | `/` | table | filter: `Enter` accepts, `Esc` cancels |
  | `Enter` | table | on a started chunk's row, activate its session's row (Sessions mode shows it); on any other row, focus the review pane |
  | `Enter` | strip | on a started chunk, activate its session's row; on any other card, nothing |
  | `x` | table | mark or unmark the cursor row |
  | `c` | table | add the marked rows, or the cursor row when none is marked, to the strip's cursor chunk, or to a new chunk when the strip's cursor is on New chunk; the marks clear |
  | `u` | table | take the marked rows, or the cursor row, out of their chunks; the marks clear |
  | `r` | table, strip | rename the cursor row's chunk, or in the strip the cursor chunk (the rename box: `Enter` accepts, `Esc` cancels) |
  | `s` | table, strip | start the cursor row's chunk, or in the strip the cursor chunk |
  | `S` | table, strip | start every shown unstarted chunk with titles |
  | `H` | table, strip | turn the chunk's headless flag on or off |
  | `h` / `l` | strip | previous / next chunk; past the last chunk, the New chunk card |
  | `gl` | table, review pane | show or hide the commits since the cursor item was written, in the review pane |
  | `W` | table | send the staleness sweep for the filtered repo to the assistant; with no repo filter, toast `Filter to one repo first` and send nothing |
  | `R` | table | rescan |
  | `o` | table, review pane | open the cursor item's file in Docs mode, at its line |
  | `Ctrl+j` / `Ctrl+k` | table, review pane | scroll the review pane a line (with `Shift`, half a page) |
  | `Space v b` | any | show or hide the assistant pane; with Backlog hidden, show Backlog and open the pane |
  | `Space v r` | any | pick the repo to filter to (the list picker `Repos`: `All repos`, then each repo) |
  | `Space v a` | any | show only agent-ready follow-ups |
  | `Space v c` | any | hide follow-ups in a chunk |
  | `Space v s` | any | sort stale follow-ups first |
  | `Space v d` | any | show or hide done follow-ups |
  | `Alt+h` / `Alt+l` | core | table ↔ review pane; `Alt+l` from the review pane or the strip into the assistant pane while it shows; `Alt+h` from the assistant pane back to the last pane |
  | `Alt+j` / `Alt+k` | core | table or review pane → chunk strip / strip → table |
  | `Enter` / `Esc` | the assistant's ask box (`scoped-agents.ask`) | send the first message / leave the box |

  The strip is a pane the core's focus keys reach, never a pushed scope. Every non-vim key gets its anchor where it
  acts (`AGENTS.md` § Key hints). The table's cursor prompt shows only the commands that apply to the cursor row: a
  row in a started chunk takes `session`, `commits` and `docs`; a row in an unstarted chunk `mark`, `chunk`,
  `unchunk`, `start`, `headless`, `rename`, `commits` and `docs`; a row in no chunk `mark`, `chunk`, `commits` and
  `docs`.

## Follow-ups

- Backlog parses each follow-up file itself through the shared module (`src/shared/followups/`). The docs index
  supplies which files exist and their repo and home.
- A repo normally has one features home. A stray second home (an in-repo `docs/features/` and a
  `~/wigley-features/<repo>/`) adds its rows under the same repo (when two items share a repo and title, the first one read keeps the row). A home that is a linked git worktree's
  (`git worktree add`) own `docs/features/` is not listed: it is a second checkout of a clone's own home.
- Backlog watches the follow-up files it lists, so an agent's append mid-session shows live.
- Done items (struck through, or one line starting `shipped`) are hidden until `Space v d` shows them. An empty table
  says why it is empty (§ The table and filters).
- An item's images live in the home's `followups-images/<folder>/`, linked from its body as `![<n>](<path>)`
  (`docs/features/notes/design.md`). Only a link that resolves to a direct subfolder of `<home>/followups-images/`
  counts.

## Tags

- A tag lives in the follow-up's own line: one italic span after the dash, comma-separated, closed by a colon
  (`- **Title** — *agent-ready*: gist`). A single tag reads exactly like the older `*needs a feature plan*:` marker,
  so existing files parse unchanged. The shape and the criteria for `agent-ready` live in wigley-ai-marketplace's
  `skills/review/triage.md` § The project's follow-ups; the docs index parses tags into `meta.tags`. In a file of
  `##` sections the span is read from the item's Contents line only, and `_a, b_:` reads like `*a, b*:`.
- The `tags` setting, defaulting to `agent-ready` and `needs a feature plan`, is the list the notes popup offers
  through Backlog main's `tags` export.
- Skills tag each follow-up they write. The table's ready column shows `agent-ready`; the page changes no tag, and the assistant changes one on the user's ask.

## The table and filters

- One row per follow-up, across every repo: homes in load order grouped by repo, then file order, then item order.
  A row shows its repo, its task (the title and the one line), ready (`agent-ready`), its staleness level (`…` until
  read) and its chunk's name.
- A row's key is `<repo>\n<title>` (`RowKey`, built by `rowKey` in the plugin's own folder, so main and the page make
  the same key). Selection, marks and chunks hold row keys.
- Filters, combined, each a button in the filter bar (on or off), with a `<n> marked` tag after them while rows are
  marked:
  - the repo button (`All repos`, or the repo): opens the repo picker, as `Space v r` does
  - Ready (`Space v a`): only `agent-ready` rows
  - Hide chunked (`Space v c`): rows in no chunk
  - Stale first (`Space v s`): rows sorted, stably, `stale`, then `moved`, `unknown`, `fresh`, then rows whose
    staleness is not read yet
  - Done (`Space v d`): done rows shown
  - `/`: a text filter, trimmed: fuzzy over the title and each tag, a plain substring over the one line
- A filter change keeps the cursor on its row while the row still shows, else moves it to the row now at its place.
- A started chunk's rows dim, and their chunk cell carries a link icon: `Enter` on the row activates that session's
  row.
- The review pane always shows the cursor item: its title, tags, staleness note, one line, repo and file, its chunk
  (`In chunk <name>`, `, started` while started) and its body. `gl` shows or hides the commits since the item was
  written under it (`Commits since written`; `commitsSince` over the channel, read once per cursor row), and the
  choice holds across cursor moves. The list reads `Reading commits…` until it arrives and
  `No commits since it was written.` for none.
- The staleness note, verbatim (`<date>` is the first 10 characters of `writtenAt`):
  - no entry yet: `Staleness not read yet.`
  - `unknown`: `Unknown: not in git history.`
  - otherwise `<Level>: written <date>` (`<Level>: not in git history yet` while `writtenAt` is null, as for a stale
    item), then, joined by ` · `: `names no paths` when the item names none, else, only when `writtenAt` is set,
    `<n> commit(s) since on <k> named path(s)`; `gone: <paths joined ', '>` when any; `last: <subject>` when a commit
    touched them. Example: `Moved: written 2026-10-20 · 3 commits since on 2 named paths · last: Fix the strip`.
- An empty table says why, the first that holds:
  - a text filter: `No rows match "<filter>".`
  - every item of the filtered repo done, done hidden: `Every follow-up here is done.`
  - Ready on: `No agent-ready follow-ups here.`
  - Hide chunked on: `Every follow-up here is in a chunk.`
  - else: `No follow-ups yet: ask the assistant to add one.`, with the `Space v b` hint
- The title bar shows `Backlog` with the repo filter (`All repos` for none).
- `backlog.place` keeps the page's place across a reload: the selected key, the repo filter, the text filter, the
  marked keys, each filter toggle and whether the assistant pane shows. The first load puts it back (a repo or mark
  no row holds is dropped, and a gone selected key selects the first row) and opens the assistant pane when it showed.
  Main reads it for `read_backlog_state`.

## Staleness

- Staleness is git-only, and main computes it. It runs no agent.
- The signals, per open item:
  - `writtenAt`: the date of the commit that first added the item's anchor to its file, in the home's clone
    (`Git.firstAdded`, the oldest non-merge commit whose diff added the text, through `git log -S`). The anchor
    (`itemAnchor`) is the title with the bold marks, `## ` marker and closing `:` or `.` around it, and falls back to
    the bare title when the item's line does not hold it or no commit added the anchor. History is read at the file's current path, with no
    `--follow`, so a follow-ups file that moved or split dates its items at the move.
  - `namedPaths`: the repo paths the item's one line and body name (below)
  - `commitsSince`: the commits after `writtenAt` that touched a named path, in the repo folder's clone (`Git.log`,
    the latest 100 read), with the latest as `lastCommit`
  - `gonePaths`: the named paths missing from the repo folder
- Named paths: each text between single backticks, outside fenced code, with a trailing `:<line>` reference, a
  leading `./` and a trailing `/` stripped. A candidate counts when it holds a `/` or ends in a file extension, and
  holds no space, `:`, glob, bracket, quote or any of `<>$=,|#`, and no leading `/`, `~`, `-` or `..`. A candidate counts only when
  the repo folder holds its first segment, so a path relative to somewhere else, or a dotted name such as
  `info.host`, is left out. A repo with no folder (§ Chunks, Folder rule) names no paths.
- Staleness reads every path through its real path, so a home or repo folder reached through a symlink reads
  correctly. A follow-up file that is not below its clone's real path has no written date, so it reads `unknown` unless a named
  path is gone.
- The home's clone and the repo folder's clone are the same for an in-repo home and differ for a
  `~/wigley-features/<repo>` home; each git path is relative to its own clone.
- The level rule, first match wins:
  1. any gone path → `stale`
  2. any commit since → `moved`
  3. no history (the home is outside git, a git call failed, or the follow-up file is not below its clone, so `writtenAt` is null) → `unknown`
  4. else → `fresh`
- `namedPaths` and the level rule (`stalenessOf`) are pure functions; a reader runs them over the injected `Git` and
  `Files`. A failed git call logs `staleness of <title>: <error>`, and a path not below its clone logs
  `staleness of <title>: <path> is not below its clone <clone>`.
- Main caches each item's staleness in `staleness.json` in its plugin data, keyed by row key. An entry holds while
  both clones' HEAD shas and the item's one line and body are as they were, so an uncommitted edit that names a new
  path reads again. The page's `staleness()` returns the valid cached entries at once; main reads the rest one row at
  a time and sends them in `stalenessRead` messages, ten rows to a message.

## Chunks

- A chunk is a named group of follow-ups for one session: its id, repo, name, the item titles, a headless flag, and the
  session id once started. The strip shows the chunks in the order they were made (only the filtered repo's while a
  repo filter is set), then the New chunk card.
- **Store:** chunks live in `chunks.json` in Backlog's plugin data, not in the follow-up files. No file tag and no
  skill change marks a chunked item. Backlog main is the one writer, and runs one store call at a time: the page's
  `editChunks` and `startChunks` and the assistant's `set_backlog_chunks` all go through it, and every change sends
  `chunksChanged` to the page. A `chunks.json` main cannot read is renamed aside and logged, never overwritten.
- **Rules:**
  - A chunk holds rows of one repo.
  - A row sits in at most one chunk. Adding a row that sits in another unstarted chunk moves it.
  - A started chunk's rows cannot join another chunk or leave theirs, and its headless flag cannot change; it may be
    renamed.
  - A chunk being started cannot be edited, replaced or pruned until its session is stored: an edit to it is refused
    `<name> is starting`.
  - An `add` with no chunk id makes a new chunk named after the first title.
  - A chunk left with no rows is deleted.
  - A rename trims the name; an empty name is refused.
  - A refused edit rejects with the reason, writes nothing, and the page toasts the reason as an error.
- **Start:** `s` starts one chunk, `S` every shown unstarted chunk, skipping empty chunks. A start launches one session through chat's
  `launch` in the repo's folder, under chat's default profile, headless only when the chunk's headless flag is on. It
  has no owner: it is the user's own session, with its row in the Sessions side bar. The chunk stores the new session's
  id. The result is one `ChunkStart` per chunk, its session id or the refusal; the page toasts `Started <name>` or the
  refusal. A start is refused for a chunk already started, a chunk already starting, a chunk none of whose rows is open in the
  backlog (`None of <name>'s follow-ups are open in the backlog`), a repo with no folder, chat with no profile, a
  launch that fails, `<name>'s session closed as it started`, or a launched session the store did not keep (`<name> started session <id>, but it was not
  stored: <reason>`; the start goes on to the next chunk).
- **First message:** the `launchBrief` setting, then one block per open (not done) item in the chunk's order: `## <title>`, the one
  line, the body, and `From <file path>:<line>`. Parts are trimmed and joined by blank lines; an empty part is left
  out, and a title with no row is left out. The builder (`chunkMessage`) is a pure function.
- **Folder rule:** one rule serves starts and staleness. The repo's folder is:
  1. the folder above `docs/features` when the home's path ends in `docs/features` and the home is in a git clone
     (a repo that is a folder of a larger clone counts)
  2. else the `folder` of the first `repoFolders` entry whose `repo` is the repo, `~` expanded
  3. else none: the start is refused with
     `<repo> has no folder: add { "repo": "<repo>", "folder": "<its folder>" } to the backlog setting repoFolders`
- **Retire:** chat's `sessionClosed` for a chunk's session retires the chunk: main removes it from the store, and its
  rows show as unchunked. A started chunk whose session chat no longer holds (it ended while the app was closed) is
  retired at the next edit or start, before it applies.

## The assistant

- The assistant is one global scoped agent (`docs/features/scoped-agents/design.md`), agent id `assistant`, scope
  `global`, title `Backlog assistant`. It runs from the home folder under chat's default profile. Its store is
  `assistant.json` in Backlog's plugin data: it supersedes nothing, and an ask may launch at any time. Its
  instructions tell it the user's view is out of its sight, so it reads `read_backlog_state` before acting on the
  cursor, marks or filters; that it edits follow-up files directly, in their own shape; and that it lands each change
  per that repo's rules and reports each change by repo and title.
- The assistant pane sits at the end of the page, hidden until `Space v b` shows it. It shows the ask box (heading
  `Backlog assistant`, hint `Ask to add, rewrite or drop follow-ups in any repo, or to group them into chunks.`) until
  the first message, then the assistant's chat view.
- The assistant makes every edit to a follow-up file. The user asks it in the pane; it edits the files with its own
  tools and lands the change per that repo's rules.
- **Tools**, both MCP tools every session lists and only the assistant may call (any other session gets the error
  result `<tool> answers only the Backlog assistant session.`; the check runs at call time, since the tool list is
  global):
  - `read_backlog_state`: Markdown of the view (cursor, marked rows, filters), the cursor item's full text and
    staleness, the chunks, and every open row (done rows too while shown) by repo with its ready, staleness and chunk
  - `set_backlog_chunks`: replaces one repo's unstarted chunks with the given `{ name, titles }` list; started chunks
    stay as they are, and an empty list removes the repo's unstarted chunks. A refusal reads `Refused: <reason>`.
- **Sweep:** `W` sends the staleness sweep for the filtered repo to the assistant as a message, through the
  channel's `sweep(repo)`. The message lists the repo's follow-up files and its open `stale` and `moved` items, and
  asks the assistant to fix the files: remove landed items, rewrite drifted ones, keep the rest, check every item
  against the code, land the change per that repo's rules, and report each change. The page then opens the pane when
  hidden and refreshes it, so it shows the assistant's chat view.

## Seams

- Docs owns the index and the write guard. It exports the machine index read and rebuild, the doc read, the guarded
  write and the file watch from its main part, and Backlog goes through them, so the changed-on-disk check stays in
  one place.
- `src/shared/followups/` is the one writer of the follow-up shape in the app, and is pure (text in, text out, no
  I/O): Backlog's `fileNote` and Docs' create dialog both call it.
- Backlog's main part exports `load` (the homes), `tags` and `fileNote` (the follow-up write with the note's images)
  to the `notes` plugin, so every follow-up and image write in the app other than Docs' create dialog and the
  assistant's own edits goes through Backlog.
- Git runs behind the `Git` contract (`src/contracts/git.ts`), with one adapter over ProcessRunner (`src/main/git/`).
  Staleness reads through its `log` and `firstAdded`. The Backlog self-test's fixture repo runs git through `services.processes`.
- The follow-up format has two readers in two languages: the shared module here, and `docs_index.py`'s parser for
  agents and other index readers. Each is tested against the format triage.md gives; a change to the format changes
  both in the same piece of work.
