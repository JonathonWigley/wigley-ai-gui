# 03 — Main parser, sections, history

Status: not started
Type: Batch
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

Files:
- create `src/plugins/docs/sections.ts`
- create `src/plugins/docs/wiki-main.ts`
- create `src/plugins/docs/page/doc-history.ts`
- test: create `src/plugins/docs/sections.test.ts`
- test: create `src/plugins/docs/wiki-main.test.ts`
- test: create `src/plugins/docs/page/doc-history.test.ts`

Consumes: `splitFrontmatter(text: string): SplitDoc` in `src/plugins/docs/frontmatter.ts` (exists).

Produces:
- in `src/plugins/docs/sections.ts`:
  - `export interface DocSection { title: string; level: number; startLine: number; endLine: number }`
  - `export function sectionsOf(text: string): DocSection[]`
  - `export function spliceSection(text: string, section: DocSection, next: string): string`
  - `export function sectionAt(sections: readonly DocSection[], line: number): DocSection | null`
  - `export function sectionText(text: string, section: DocSection): string`
  - `export interface ScannedLine { number: number; text: string; heading: { level: number; title: string } | null; isProse: boolean }`
  - `export function scanLines(text: string): ScannedLine[]`
- in `src/plugins/docs/wiki-main.ts`:
  - `export function parseWikiMain(text: string): WikiShelf[]`
  - `export interface WikiShelf { title: string; items: WikiItem[] }`
  - `export type WikiItem = { type: 'label'; title: string } | { type: 'page'; title: string; target: WikiTarget }`
  - `export type WikiTarget = { type: 'path'; path: string } | { type: 'skill'; name: string } | { type: 'kind'; kind: string } | { type: 'owner'; owner: 'third-party' } | { type: 'all' }`
- in `src/plugins/docs/page/doc-history.ts`:
  - `export function createDocHistory(): DocHistory`
  - `export interface DocHistory { push(place: DocPlace): void; back(): DocPlace | null; forward(): DocPlace | null; canBack(): boolean; canForward(): boolean }`
  - `export interface DocPlace { path: string; line: number | null }`
  - `export const DOC_HISTORY_LIMIT = 100`

## Decisions: one line scan

`Main.md` and a section both need one answer to "is this line a heading, or code". So `scanLines` in `sections.ts` holds the rules, and `wiki-main.ts` reads its result.

`scanLines` gives one `ScannedLine` per line of the file:
- `number` is 1-based and counts from the file's first line, frontmatter included.
- `text` is the line with its line ending removed.
- A file's last line ending does not make one more line. `a\n` has one line. `a\n\n` has two.
- Lines break on `\n`. A `\r` before the `\n` belongs to the line ending. A lone `\r` is text. The index parser does the same: task 01 `body_lines` and `prose_lines` split on `\n` only and drop one trailing `\r`. So `headings[].line` and `sectionsOf` name the same lines for every file, and task 09 can pair them by `line`.
- Frontmatter starts when line 1 is exactly `---`, with no leading whitespace, as task 01 pins for the index. Use the same test in `scanLines`, and read `bodyStartLine` from `splitFrontmatter`. If `splitFrontmatter` accepts a `---` with leading whitespace, `scanLines` still applies the exact test first, and treats the file as having no frontmatter when it fails.
- `isProse` is false on a frontmatter line, on a fence line and on a line inside a fence. It is true on every other line.
- `heading` is null unless `isProse` is true and the line is a heading.

Frontmatter comes from `splitFrontmatter`: lines before `bodyStartLine` are not prose. An unclosed `---` block is all body, as `splitFrontmatter` has it.

**Fences match `_lines_outside_fences` in the index's `markdown.py`.**
- A fence opens on a line whose text after leading whitespace starts with 3 or more backticks or 3 or more tildes.
- A backtick run whose remaining text holds a backtick is a code span and does not open a fence.
- A fence closes on a run of the same character, at least as long, with only whitespace after it.
- An unclosed fence runs to the end of the file.
- Any indent counts, so a fence inside a list item counts.

**A heading** matches `/^(#{1,6})\s+(.+?)\s*#*\s*$/`, the `HEADING` expression that task 01 gives the index. So the index's `headings` and `sectionsOf` name the same lines, and task 09 can pair them by `line`. The title is the second group, and it keeps inline markdown as written. These are not headings: `#` alone, `#word`, `#######` and more, an indented line, and a setext underline.

## Decisions: sectionsOf and spliceSection

`sectionsOf` gives one `DocSection` per heading, in file order. Sections nest: `## A` holds its `### A1`, so their line ranges overlap.

**End of a section.** `endLine` is the line before the next heading of the same or higher level (`level` less than or equal to this one's), else the file's last line.

**The lead title.** A section that runs to the end of the file would swallow the page. So when the file's first heading has level 1, it is the lead section, and it ends on the line before the next heading of any level. The lead section holds the title and the intro. `e` on the intro then edits only those lines.
- Only the first heading can be the lead.
- `# B` after `## A` is not a lead. It follows the normal end rule.
- A second `#` follows the normal end rule.

**`sectionAt`** gives the last section with `startLine <= line`. That is the deepest section holding the line. It gives null above the first section.

**`e` above the first section.** Lines above the first section are frontmatter, or text above the first heading, or a doc with no heading. `sectionAt` gives null there, and task 09 opens the whole-file editor, as `i` does. Text above the first heading has no section of its own, and `e` never does nothing.

**`spliceSection` replaces by offset, not by rebuilding lines.** It replaces the text from the start of `startLine` to the end of `endLine`, without the line ending of `endLine`. Every other byte of `text` stays as it was: mixed line endings, a missing last line ending, and trailing blank lines.
- `next` has its `\r\n` turned into `\n`. Then each `\n` becomes the file's line ending.
- The file's line ending is the ending of its first line break: `\r\n` when a `\r` comes before the first `\n`, else `\n`. A file with no line break uses `\n`.
- An empty `next` leaves one empty line where the section was. There is no special case.

**`sectionText`** gives the lines from `startLine` to `endLine`, with no line ending after the last line, joined with `\n`. The editor holds `\n` text. For a file with one kind of line ending, `spliceSection(text, s, sectionText(text, s))` equals `text`. A caller computes the section from the same `text` it splices. Task 09 checks the disk through the existing conflict flow.

## Decisions: parseWikiMain

The parser reads the `isProse` lines of `scanLines`. It never throws.

- A level 2 heading starts a shelf, with the heading's title. A shelf with no items stays, with `items: []`.
- A level 3 heading adds `{ type: 'label', title }` to the current shelf. Before the first shelf it is ignored.
- A level 1 heading and levels 4 to 6 add nothing and start nothing. Links under them still belong to the current shelf.
- A link before the first level 2 heading is ignored.
- A heading line adds no links. A link in a heading's text is part of its title.
- Every other prose line adds one page per link, in reading order. So a link inside a paragraph under a shelf counts as a page, and a line can add several. This is `../design.md` § Main page and sidebar: each markdown link under the headings is a page.

**A link** is found on the original line, with this expression. A match is dropped when its `[` falls inside a code span. Find the code spans on the same line with `/(`+).*?\1/g`, and compare offsets: a span covers the offsets from its start to its end. A code span inside the link text does not drop the link, so `` [`make`](wigley:make) `` is a page titled `` `make` ``.

`/(?<![!\\])\[([^\]]+)\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+"[^"]*")?\s*\)/g`

- An image (`![a](b)`), an escaped bracket (`\[a](b)`) and empty link text (`[](b)`) are not pages.
- The link text is the page's `title`, as written.
- A target in `<…>` loses the angle brackets.
- A target that holds a `)` ends at the `)`.
- Reference-style links and HTML comments get no special handling.

**Targets**, tried in this order on the exact text:

| Target text | Result |
|---|---|
| `wiki:all` | `{ type: 'all' }` |
| `wiki:owner/third-party` | `{ type: 'owner', owner: 'third-party' }` |
| `wiki:kind/<kind>`, where `<kind>` is non-empty and holds no `/` | `{ type: 'kind', kind }`. A kind the app does not know stays, since the index may name others |
| any other text starting `wiki:` | no item: the link is dropped from the shelf |
| `wigley:<name>`, where `<name>` is non-empty and holds no `/` | `{ type: 'skill', name }` |
| any other text | `{ type: 'path', path }`, raw. `~/`, relative paths, fragments and URLs stay unresolved. `buildWikiTree` (task 06) resolves them |

A dropped `wiki:` link produces no error, no toast and no row, because the page has no way to act on it. The file still renders it on the Main page. The parser holds no shelf name.

## Decisions: DocHistory

The history is a list and a position. The entry at the position is the place shown now.

- `push(place)`:
  - When `place` equals the current entry (`path` and `line` both exactly equal), nothing changes, and forward entries stay.
  - Otherwise, it removes every entry after the position, appends `place`, and moves the position to it.
- `back()` moves one entry back and returns it. At the first entry, or with no entries, it returns null and does not move.
- `forward()` moves one entry forward and returns it. At the last entry, or with no entries, it returns null and does not move.

- `canBack()` is true when an entry exists before the position. `canForward()` is true when an entry exists after it. Neither moves the position. `DESIGN.md` says a pair of controls hides with nothing to move to, so task 10 hides each control from these two names.

The no-change rule lets task 10 open a place that `back()` returned and call `push` the usual way, with no forward entries lost.

**The cap** is `DOC_HISTORY_LIMIT = 100`. A push past the cap removes the oldest entry. The position stays on the new entry. The value is a constant, not a setting: it bounds memory, and no user tunes it (`~/wigley-agents/decisions.md` § Architecture, Config, names a value someone could tune). Each docs view makes its own history (`../design.md` § Keys). The module touches no DOM.

## Behaviour

GIVEN a doc with a `# Title`, an intro and `## A` WHEN `sectionsOf` runs THEN the `# Title` section ends before `## A`.
GIVEN a CRLF file WHEN a section is spliced with `\n` text THEN every line of the result ends in `\r\n`, and each other line is unchanged.
GIVEN a shelf with a `wiki:nonsense` link and one page WHEN the file is parsed THEN the shelf holds the one page.
GIVEN a history after `back()` WHEN a new place is pushed THEN `forward()` returns null.

## Tests

Built text only. Use test names like `Shelf`, `Label` and `Page`. No test names a real shelf from `Main.md`.

`src/plugins/docs/sections.test.ts`:

`sectionsOf_Ranges` (`it.each`), with `\n` joining the lines. The break is an off-by-one, or a lead that swallows the page, or a heading read inside a fence or frontmatter.

| given | lines | expected `[title, level, startLine, endLine]` |
|---|---|---|
| lead, nesting, frontmatter and a fence | `---`, `name: x`, `---`, `# T`, `intro`, `## A`, `a`, `### A1`, `a1`, `## B`, three backticks, `## not`, three backticks, `end` | `[T,1,4,5]`, `[A,2,6,9]`, `[A1,3,8,9]`, `[B,2,10,14]` |
| last line ending does not add a line | `# T`, `## A`, `a`, then an empty last element | `[T,1,1,1]`, `[A,2,2,3]` |
| first heading is not level 1 | `intro`, `## A`, `# B`, `b` | `[A,2,2,2]`, `[B,1,3,4]` |
| second `#` is no lead | `# T`, `x`, `# U`, `y`, `## V`, `z` | `[T,1,1,2]`, `[U,1,3,6]`, `[V,2,5,6]` |
| lead alone | `# T`, `x` | `[T,1,1,2]` |
| all six levels | `# a`, `## b`, `### c`, `#### d`, `##### e`, `###### f` | `[a,1,1,1]`, `[b,2,2,6]`, `[c,3,3,6]`, `[d,4,4,6]`, `[e,5,5,6]`, `[f,6,6,6]` |
| CRLF file | `# T\r\n## A\r\na\r\n` | `[T,1,1,1]`, `[A,2,2,3]` |
| closing hashes | `## A ##` | `[A,2,1,1]` |
| `---` with a leading space is no frontmatter | ` ---`, `# x`, `---`, `# y` | `[x,1,2,3]`, `[y,1,4,4]` |
| a lone `\r` is text | `# T\ra`, `## A` | `[T,1,1,1]`, `[A,2,2,2]` |
| not headings | `#`, `#word`, `####### x`, `  # x`, `    # x` | none |
| tilde fence closed by a longer run | `~~~`, `# x`, `~~~~`, `# y` | `[y,1,4,4]` |
| backtick run with a backtick after it is no fence | a line of three backticks, a space, one backtick, a closing three backticks; then `# y` | `[y,1,2,2]` |
| unclosed fence | three backticks, `# x` | none |

`sectionAt_Line` (`it.each`), over the sections of `intro`, `## A`, `a`, `### A1`, `a1`, `## B`. The break is the first match in place of the deepest.

| line | expected title |
|---|---|
| 1 | null |
| 2 | `A` |
| 3 | `A` |
| 5 | `A1` |
| 6 | `B` |

`spliceSection_KeepsEveryOtherByte` (`it.each`), each row splicing the section titled `A`. The break is a rebuilt file that loses a `\r`, a last line ending or a blank line.

| given | text | next | expected |
|---|---|---|---|
| LF | `# T\n\n## A\na\n\n## B\nb\n` | `## A\nz` | `# T\n\n## A\nz\n## B\nb\n` (A's range holds its trailing blank line) |
| CRLF, next in LF | `# T\r\n## A\r\na\r\n## B\r\n` | `## A\nz\ny` | `# T\r\n## A\r\nz\r\ny\r\n## B\r\n` |
| CRLF, next in CRLF | `## A\r\na\r\n` | `## A\r\nz` | `## A\r\nz\r\n` |
| no last line ending | `## A\na` | `## A\nz` | `## A\nz` |
| last line ending stays | `## A\na\n` | `## A\nz` | `## A\nz\n` |
| mixed endings stay | `x\r\n## A\na\n# B\ny\n` | `## A\nz` | `x\r\n## A\r\nz\n# B\ny\n` (the file's first ending inside `next`; the ending after `endLine` and every later line stay) |
| empty next | `## A\na\n` | empty | `\n` |

`spliceSection_SectionText_RoundTrips` (`it.each`) over one LF and one CRLF text: the result equals the input for each section of `sectionsOf`. The break is a line-ending mismatch between the two functions.

`src/plugins/docs/wiki-main.test.ts`:

`parseWikiMain_Structure`. One test on one built text, with exact `toEqual`. The text holds, in order: a `# Top`, a paragraph with a link, a `### Early` label, `## Shelf A`, `- [One](a.md)`, a paragraph `see [Two](b.md) and [Three](c.md)`, a `### Label`, `- [Four](d.md)`, a fence that holds `## Not` and `[No](n.md)`, an inline code span holding `[No](n.md)`, an image `![No](n.png)`, `#### Deep`, `- [Five](e.md)`, `## Empty`, and `## Shelf B`, `- [Six](f.md)`. The result is three shelves:
- `Shelf A` holds pages One, Two, Three, label `Label`, pages Four and Five.
- `Empty` holds `[]`.
- `Shelf B` holds page Six.

The break is any one of the rules above removed.

`parseWikiMain_LinkText`. One built shelf holding `` [`code`](a.md) ``, `` `[No](n.md)` `` and `` see `x` [Two](b.md) ``. The pages are `` `code` `` with path `a.md`, and `Two`. The break is a link whose text holds a code span, lost with the span.

`parseWikiMain_Target` (`it.each`), a shelf holding one link whose parenthesised target is the text in the first column, as written: the row `<a b.md>` builds `[P](<a b.md>)`. The break is a reordered or loosened match.

| target | expected items |
|---|---|
| `~/a.md` | path `~/a.md` |
| `../a.md` | path `../a.md` |
| `<a b.md>` | path `a b.md` |
| `https://x.test` | path `https://x.test` |
| `wigley:make` | skill `make` |
| `wigley:a/b` | path `wigley:a/b` |
| `wigley:` | path `wigley:` |
| `wiki:kind/skill` | kind `skill` |
| `wiki:kind/made-up` | kind `made-up` |
| `wiki:owner/third-party` | owner `third-party` |
| `wiki:all` | all |
| `wiki:` | none |
| `wiki:other` | none |
| `wiki:kind/` | none |
| `wiki:kind/a/b` | none |
| `wiki:owner/mine` | none |
| `wiki:all/x` | none |

`src/plugins/docs/page/doc-history.test.ts`. Use the places `a`, `b`, `c` with `line: null`.

`docHistory_Moves` (`it.each`, each row a list of calls and the expected return of the last). The break is a missed truncate, a duplicate, or a move past an end.

| given | calls | last returns |
|---|---|---|
| new history, back | `back` | null |
| new history, forward | `forward` | null |
| one place, back | `push a`, `back` | null |
| at the last entry, forward | `push a`, `push b`, `forward` | null |
| back moves one | `push a`, `push b`, `back` | `a` |
| forward undoes back | `push a`, `push b`, `back`, `forward` | `b` |
| push truncates forward | `push a`, `push b`, `back`, `push c`, `forward` | null |
| push truncates, and the old entry is gone | `push a`, `push b`, `back`, `push c`, `back` | `a` |
| same place twice adds one | `push a`, `push a`, `back` | null |
| same place keeps forward | `push a`, `push b`, `back`, `push a`, `forward` | `b` |
| same path, other line is a new place | `push a`, `push a line 5`, `back` | `a` |
| a failed back does not move | `push a`, `push b`, `back`, `back`, `forward` | `b` |

`docHistory_CanMove` (`it.each`, each row a list of calls and the expected `[canBack, canForward]` after them). The break is a flag that follows the length, or that moves the position.

| given | calls | `[canBack, canForward]` |
|---|---|---|
| new history | none | `[false, false]` |
| one place | `push a` | `[false, false]` |
| two places | `push a`, `push b` | `[true, false]` |
| after back | `push a`, `push b`, `back` | `[false, true]` |
| after a push that truncates | `push a`, `push b`, `back`, `push c` | `[true, false]` |
| a failed back | `push a`, `back` | `[false, false]` |
| the same place twice | `push a`, `push a` | `[false, false]` |

`docHistory_Cap_DropsOldest`. Push `DOC_HISTORY_LIMIT + 1` places with distinct paths, then call `back` `DOC_HISTORY_LIMIT` times. The last call returns null, and the call before it returns the second place pushed. Then do the same with `DOC_HISTORY_LIMIT` places: the first place is still reachable. The break is an off-by-one at the cap, or a position left stale after a drop.

## Done when

The project compiles. `wigley:make`'s test gate runs the tests above. No source line in these modules names a shelf or a workflow. Task 14 holds every runtime check.

Commit: one commit for the group.

## Proof

