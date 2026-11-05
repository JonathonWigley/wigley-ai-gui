# 01 — Index schema 5: headings, links and the wiki walk

Status: in progress
Type: Task
Wave: 1 · Depends on: none
Plan: [plan.md](plan.md)

All paths are relative to the root of the run's wigley-ai-marketplace worktree (`~/wigley-agents/WigleyRepos.md` § Landing). `D` means `plugins/wigley/scripts/docs-index`.

Files:     create `D/section_refs.py` · create `D/doc_fields.py` · modify `D/model.py` · modify `D/discover.py` · modify `D/docs_index.py` · modify `D/markdown.py` · modify `D/README.md` · modify `scripts/check_pointers.py` · modify `AGENTS.md` · modify `plugins/wigley/.claude-plugin/plugin.json` · modify `plugins/wigley/.codex-plugin/plugin.json` · test `D/tests/test_section_refs.py` (create) · test `D/tests/test_doc_fields.py` (create) · test `D/tests/test_model.py` · test `D/tests/test_docs_index.py` · test `D/tests/test_discover.py` · test `scripts/tests/test_check_pointers.py`

Consumes:  nothing from another task. `D/session.py` does not change: `docs_index.py` adds the fields to its entries (Decisions, Session).

Produces:
- `index.json`, and the printed document of `context` and `session`: `"schemaVersion": 5`. Each entry gains the fields below, after `lastLoaded`, both always present. Task 02 reads this shape.
  - `headings`: `[{ "level": int, "text": str, "line": int }]`. `line` is 1-based in the file.
  - `links`: `[{ "form": "markdown" | "section", "raw": str, "target": str, "line": int, "targetLine": int | null }]`. `raw` is the exact source text of the reference. `target` is the real path of the target file. `line` is the source line, 1-based. `targetLine` is the target heading's 1-based line, or null when the link names a file only.
- In `D/model.py`:
  - `SCHEMA_VERSION = 5`
  - `LINK_FORMS = ("markdown", "section")`
  - `@dataclass(frozen=True) class DocHeading: level: int; text: str; line: int; def to_json(self) -> dict`
  - `@dataclass(frozen=True) class DocLink: form: str; raw: str; target: str; line: int; target_line: int | None; def to_json(self) -> dict`. `__post_init__` raises `ValueError` for a form outside `LINK_FORMS`.
  - `Entry.headings: tuple[DocHeading, ...] = ()` and `Entry.links: tuple[DocLink, ...] = ()`
- In `D/section_refs.py`, the one § parser. It imports the standard library and `markdown` only:
  - `POINTER_LEVELS = (2, 3)`, `ALL_LEVELS = (1, 2, 3, 4, 5, 6)`, `NESTED_SEPARATOR = " › "`, `EMPHASIS`
  - `SECTION_POINTER`, with the groups `skill` and `file`, `MARKDOWN_LINK`, `BARE_BLOCKER`
  - `class Heading: def __init__(self, level: int, text: str, line: int)`, with `children: list[Heading]`
  - `@dataclass(frozen=True) class HeadingWalk: heading: Heading | None; length: int; problem: str | None`
  - `def prose_lines(text: str) -> list[str]`
  - `def body_lines(text: str) -> list[str]`
  - `def parse_headings(lines: list[str], levels: tuple[int, ...] = ALL_LEVELS) -> list[Heading]`
  - `def read_headings(path: Path) -> list[Heading]`
  - `def longest_prefixes(remainder: str, headings: list[Heading]) -> list[Heading]`
  - `def walk_headings(remainder: str, headings: list[Heading]) -> HeadingWalk`
  - `def resolve(remainder: str, headings: list[Heading]) -> str | None`
  - `def source_length(remainder: str, plain_length: int) -> int`
  - `class ProseText: def __init__(self, lines: list[str])`, with `text: str`, `def line_of(self, offset: int) -> int`, `def source(self, start: int, end: int) -> str`, `def in_code_span(self, offset: int) -> bool`
- In `D/doc_fields.py`: `def with_doc_fields(entries: list[Entry], home: Path) -> list[Entry]`. It returns each entry, in order, with its `headings` and `links`.
- In `D/markdown.py`: `lines_outside_fences` and `front_matter_end`, renamed from `_lines_outside_fences` and `_front_matter_end`. Change each call site in that file.

## Decisions

**Schema.** Schema 5 replaces schema 4, with no fallback. Change the value in `model.py`, in the README schema block (line 203 today), and in the two tests that assert 4: `tests/test_model.py` line 25 and `tests/test_docs_index.py` line 84. `grep -rn 'schemaVersion\|SCHEMA_VERSION' plugins scripts` shows no other value.

**Session.** All three commands get the fields in one place. In `docs_index.py`, add `_finished_entries(env, entries, times)`. It returns `with_doc_fields(_with_last_loaded(env, entries, times), env.home)`. `_build`, `_context` and `_session` call it in place of `_with_last_loaded`. `_session` passes `[*discovery.entries, *new_entries]`, so an entry from `session._loaded_file_entry` also gets the fields. So a session's Docs tab reads the same shape, and `session.py` has no edit. `build_context` and the load rules keep the entries that hold no fields.

**Wiki walk.** In `discover._walk_global`, directly after the `learning` loop, add a loop over `_markdown_below(scan, wigley_agents / "wiki")` that calls `scan.add_doc("reference", path, GLOBAL)`. `_walk_global` runs first, so the kind and the global source hold when a repo walk also reaches the clone. `Main.md` at the top of `wiki/` is `reference`, not `instructions`, because the `*.md` glob reads only the top of `wigley-agents`.

**Which entries carry the fields.** An entry has a **body** when `entry.line is None`, its kind is outside `UNLOADED_KINDS`, and `entry.path` ends in `.md`.

| Entry | `headings` | `links` |
|---|---|---|
| `mine`, with a body | parsed | parsed |
| `third-party`, with a body | parsed | `[]` |
| `hook`, `plugin` | `[]` | `[]` |
| a file that does not end in `.md` (a `skill-file` script, an imported text file) | `[]` | `[]` |
| a follow-up item (`#L<n>` id, a repo's `docs/followups/<topic>.md` at `#L1` included) | `[]` | `[]` |
| a file that raises `OSError` on read | `[]` | `[]` |

**`headings` is the flat list** of every heading that `parse_headings(body_lines(text))` returns, at all six levels, in file order. Each is `DocHeading(level, text, line)`, and `text` is `Heading.text` (backticks and `*` gone, closing hashes gone). It is not the nesting roots and not the `POINTER_LEVELS` subset. Task 07 (On this page) and task 08 (search rows) read `text`.

A follow-up file has no whole-file entry: `add_feature_file` adds one entry per item only. So no entry holds the headings or links of `followups.md`. A reference **to** a follow-up file still resolves, because the file's items list its path. Read the file with `encoding="utf-8", errors="replace"`. Read each path once in one `with_doc_fields` call.

**One parser.** Move `Heading`, `longest_prefixes`, `resolve`, `snippet`, `read_headings`, `prose_lines`, `collapse`, `CONTINUATION_LEAD`, `NESTED_SEPARATOR`, `EMPHASIS` and `HEADING` out of `check_pointers.py` into `section_refs.py`. Remove `FENCE` and `closes_fence` from `check_pointers.py`.

- `check_pointers.py` runs as a script from the repo root, and `tests/test_check_pointers.py` loads it by file path through `importlib`. `scripts/` is not a package. So add these lines above its local import, and base the path on `__file__`, because the `root` argument names a test's temp tree:
  ```python
  DOCS_INDEX = Path(__file__).resolve().parent.parent / "plugins" / "wigley" / "scripts" / "docs-index"
  sys.path.insert(0, str(DOCS_INDEX))
  ```
- `section_refs.py` and `markdown.py` import only the standard library, so the check stays standard library only.
- `HEADING` becomes `^(#{1,6})\s+(.+?)\s*#*\s*$`. `Heading.text` is the checker's text: the closing hashes are gone, and backticks and `*` are gone. Task 09 pairs a heading with a section by `line`, not by `text`.
- `parse_headings` nests each heading under the nearest earlier heading of a lower level, among `levels`. It drops other levels. `read_headings(path)` returns `parse_headings(prose_lines(path.read_text(encoding="utf-8")), POINTER_LEVELS)`, so the checker still sees `##` and `###` only.
- `prose_lines(text)` blanks each line that `markdown.lines_outside_fences(lines, 0)` does not yield. So the checker gains one rule: a line like ```` ```x``` ```` opens no fence. No file in the checker's scope holds such a line today (`grep -rnE '^\s*```[^`]*`'` printed nothing).
- `body_lines(text)` also blanks the front matter, and keeps the line count. The index uses it. The checker keeps `prose_lines`, because a `wigley:` name in a skill's front matter is still checked today.
- **Line rule.** `prose_lines` and `body_lines` split `text` on `\n` only (`text.split("\n")`), and drop one trailing `\r` from each line. They do not use `str.splitlines`. So `\r\n` files count as `\n` files, and a lone `\r`, `\x0b`, `\x0c`, `\x1c`-`\x1e`, `\x85`, U+2028 and U+2029 stay inside their line. This matches the app, which splits on `\n` (Task 03 `scanLines`). So `headings[].line`, `links[].line` and `targetLine` name the same lines as the app's sections.
- **Front matter.** The front matter is present when line 1 is exactly `---`, with no leading or trailing whitespace. It ends at the next line that is exactly `---`. `body_lines` blanks both fences and the lines between, and uses its own test: not `markdown.front_matter_end`, which accepts a `---` with whitespace. Task 03 `splitFrontmatter` uses the same rule.
- `DECISIONS_POINTER` and `SKILL_POINTER` merge into this one pattern, verbatim:
  ```python
  SECTION_POINTER = re.compile(
      r"(?<![\w./~:-])`?(?:wigley:(?P<skill>[a-z0-9][a-z0-9-]*)|(?P<file>[\w./~-]*[\w-]\.md|README))`?\s+§ ")
  ```
  `Checker.check_document` makes one pass. It checks `match["file"]` when the value is `decisions.md` or `~/wigley-agents/decisions.md`, and `match["skill"]` when the name is in `self.skills`. It ignores every other match. `WIGLEY_NAME` and `RETIRED_PATH` stay in `check_pointers.py`.
- `class Document(ProseText)` stays in `check_pointers.py`, with `where`. `ProseText` adds the source map to what `Document` holds today.
- `walk_headings` holds the loop of today's `resolve`. On a match, `heading` is the first of the deepest tied headings in file order, `length` is the matched length in the emphasis-free remainder, and `problem` is `None`. On no match, `heading` is `None` and `problem` is today's message. `resolve` returns `walk_headings(...).problem`.

**The text the parser reads.** `with_doc_fields` builds `ProseText(body_lines(text))`.

- `ProseText.text` is the output of `collapse`: one line break, with its trailing and leading whitespace and `>` markers, reads as one space. So a reference can wrap. A blank line reads as two spaces, so no match crosses a paragraph.
- `ProseText.source(start, end)` returns the source text of that range, with its real line breaks and leads.
- `ProseText.in_code_span` tests each `markdown.CODE_SPAN` match found one source line at a time. A code span that wraps a line is not seen.
- Fenced code is blank, so it holds no references.
- Lines count by the line rule under **One parser**: `\n` only, one trailing `\r` dropped. This differs from `markdown.py`, which counts by `str.splitlines`. The two agree on every file that holds none of the rare break characters, and `lines_outside_fences` takes the list it is given.

**Reference forms.** Find them in this order on `ProseText.text`. Return the links sorted by start offset. Keep duplicates.

1. **Markdown link.** A match of this pattern, verbatim, whose `[` is outside a code span:
   ```python
   MARKDOWN_LINK = re.compile(
       r"(?<!!)\[(?:[^\[\]]|\[[^\[\]]*\])*\]\(\s*(?:<([^<>]*)>|([^()\s]*(?:\([^()\s]*\)[^()\s]*)*))"
       r"(?:\s+(?:\"[^\"]*\"|'[^']*'))?\s*\)")
   ```
   `form` is `markdown`. `raw` runs from `[` to `)`. The whole span is closed to forms 2 and 3, also when it gives no link. So a `§` in link text gives no second link.
2. **File or skill pointer.** A match of `SECTION_POINTER` whose `§` is outside a code span and outside each form 1 span. `form` is `section`. A pointer that resolves to nothing gives no link, and it does not fall through to form 3.
3. **Bare `§`.** A remaining `§ ` outside a code span, with no `BARE_BLOCKER` match on the 40 characters before it. It targets the entry's own file. `form` is `section`.
   ```python
   BARE_BLOCKER = re.compile(r"(?:(?<![\w.])\d\d|(?<![\w-])[A-Z][a-z]+[A-Z]\w*)`?\s+$")
   ```
   The blocker stops `01 § Decisions` (a task number, 7 real uses) and `AgentsStandardMapping § Tools` (a file stem, 3 real uses). Each names another file that the index cannot pin.

**Backticks.** A code span holds no markdown link. A `§` inside a code span is code and gives no link: `` `decisions.md § Asking` `` is plain text. A code span that holds only the file or skill token, with the `§` outside it, is a pointer: `` `AGENTS.md` § Running and testing ``. The heading text after the `§` can hold backticks and `*`: match it with these characters removed.

**Section target.** Let `remainder` be the text after `§ `, up to the paragraph end.

- Call `walk_headings(remainder.translate(EMPHASIS), headings)` over every level of the target file (`parse_headings(body_lines(text))`).
- `§ A › B` walks `A`, then `B` among the children of `A`.
- No match gives no link, also when `A` matches and `B` does not.
- `targetLine` is the line of the walk's `heading`.
- A heading text must be a whole-word prefix of the remainder. So `§ 2` does not match `## 2. Interview impact`, because the heading text is longer than the reference.
- A target that does not end in `.md`, or that raises `OSError`, gives no link.

**`raw`.** `raw` is the exact source text the page will find, including backticks.

- A pointer's `raw` starts at the file or skill token, with its opening backtick. A bare link's `raw` starts at `§`.
- A section link's `raw` ends at the end of the matched heading text. Prose after the heading stays out.
- `source_length(remainder, plain_length)` maps the matched length back to the source. It walks `remainder`, counts each character that is not a backtick or `*`, and stops at `plain_length`. Then, for a backtick or `*` that comes next, it counts the runs of that character in the taken text. An odd count means that a run is still open, so it takes the whole next run. So a closing backtick or `**` stays in `raw`.
- A wrapped reference keeps its real line break and lead. `line` is the line where `raw` starts.

Worked examples. Each was read from the real file with `python3` on 2026-11-05. The text after `raw` shows where it stops. Line numbers can move.

| Source file and line | Source text | `raw` | Text after `raw` | `target` | `targetLine` |
|---|---|---|---|---|---|
| `wigley-ai-marketplace/plugins/wigley/skills/make/SKILL.md:160` | ``per `~/wigley-agents/decisions.md` § Asking › The agent decides; when…`` | `` `~/wigley-agents/decisions.md` § Asking › The agent decides `` | `; when` | real path of `wigley-agents/decisions.md` | 44 |
| `wigley-ai-marketplace/plugins/wigley/skills/make/SKILL.md:65` | ``per `wigley:writing-tests` § One test per behaviour: a row in the…`` | `` `wigley:writing-tests` § One test per behaviour `` | `: a row in the` | the clone's `plugins/wigley/skills/writing-tests/SKILL.md` | 101 |
| `wigley-ai-gui/docs/features/agent-chat/claude-stream.md:517` | `(§ Mode change). ` | `§ Mode change` | `). ` | the same file | 429 |
| `wigley-agents/AgentsStandardMapping.md:86` | ``has `Terminal.md` § Plugin reload). A…`` | `` `Terminal.md` § Plugin reload `` | `). A` | `wigley-agents/Terminal.md` | 18 |
| `wigley-ai-gui/docs/features/plugin-framework/plan-foundation-sweeps/14-final-verification.md:11` | ``(`AGENTS.md` § Running and testing), so…`` | `` `AGENTS.md` § Running and testing `` | `), so` | `wigley-ai-gui/AGENTS.md` | 760 |
| `wigley-ai-marketplace/plugins/wigley/skills/feature/plan-folder.md:90` | ``(`SKILL.md` §⏎Writing the plan, step 7)`` | `` `SKILL.md` § ``, a line break, `Writing the plan` | `, step 7` | `feature/SKILL.md` beside it | 156 |

These real samples give no link on today's corpus:

| Source file and line | Source text | Why |
|---|---|---|
| `wigley-agents/docs/features/unity-pool/plan-unity-pool/plan.md:67` | `` `docs/features/usage/design.md` § The right bar — 10 `` | That path is in wigley-ai-gui, and this doc sits in wigley-agents. Inside wigley-ai-gui the same text gives `` `docs/features/usage/design.md` § The right bar ``, `targetLine` 187. |
| `wigley-features/new-games-prototypes/core-event-skill/checklist.md:70` | `` (`research/tickets-delta.md` § 2). `` | The heading is `## 2. Interview impact`, and its text is not a prefix of `2).`. |
| `wigley-agents/docs/features/unity-pool/plan-unity-pool/06-hooks-and-workers.md:49` | `(README § Hooks: hooks fail open;` | No indexed `README.md` sits in that folder or at that repo root. |

**Target rules for a file token.** Every candidate goes through `os.path.realpath`. A candidate counts only when it is the `path` of a listed entry whose kind is outside `UNLOADED_KINDS`. Links in a `mine` doc to any listed entry count, third-party entries included. Use each entry's real path, not a walked path.

| Token | Resolution, first hit wins |
|---|---|
| `~/…` | `config.expand_home(token, home)` only |
| `/…` | the path only |
| holds a `/` | (a) the source's real folder, (b) the repo root |
| bare `name.md` | (a) the source's real folder, (b) the repo root, (c) the one `mine` entry path with that base name, only when exactly one exists |
| `README` | as `README.md`, steps (a) and (b) only |
| `wigley:<skill>` | the `SKILL.md` of that skill folder, among entries of kind `skill` with `plugin` starting `wigley@`: the first by path with `source == "repo"` (the marketplace clone), else the first by path with `source == "plugin"` (the install) |

- **The repo root** is `rules.nearest_repo_root` of the source's real folder.
- **A file in no repo.** An entry with `source == "features"` and no repo root is in an out-of-repo feature home. Its step (b) tries the token under the `root` of each `source == "repo"` entry with the same `repo`. Exactly one listed hit resolves. Two clones give two hits, so step (b) gives nothing and the search goes on.
- **Base name count.** Count distinct paths, so the items of one follow-up file count once.
- **`wigley:<skill>` reads `SKILL.md` only.** A heading in a sibling file gives no link. Four real references do this today, for example `` `wigley:writing-tests` § Async, in its writing-the-test.md ``. `check_pointers.py` still accepts them, because it reads every `.md` in the skill.

**Markdown link hrefs.** Take the href, split at the first `#`, and apply `urllib.parse.unquote` to the path part.

| Href | Result |
|---|---|
| holds a scheme (`^[A-Za-z][A-Za-z0-9+.-]*:`) other than `wigley:` (`https:`, `mailto:`, `wiki:`) | no link |
| `wigley:<skill>` | the skill rule above, `targetLine` null. `Main.md` links its skill pages this way, so a skill's Linked from names `Main.md`. `wiki-main.ts` still owns what the sidebar does with it. |
| `~/…` or `/…` | that path |
| any other path | relative to the source's real folder only: no repo root step and no base name step |
| `#fragment` alone | the source's own file; an unmatched fragment gives no link |

A `#fragment` matches the first heading of the target whose slug equals it. `targetLine` is that heading's line. The slug is GitHub's: lowercase, keep alphanumerics, spaces, `-` and `_`, then replace each space with `-`. An unmatched fragment on a path href keeps the link, with `targetLine` null. A target that does not end in `.md` keeps the link, with `targetLine` null. Reference-style links (`[a][b]`) give no link. An image (`![a](b)`) gives no link.

**Docs.** Change these in the same commit, so that `README.md` never states a schema that no script writes:

- `D/README.md` § The index file: the schema block value `5`, and `"headings": []` and `"links": []` in the sample entry. Under **Entry**, add `headings` and `links`, with the field shapes from Produces. Add a section **Headings and links**, with a line in **Contents**, that states the reference forms, the target rules, `raw`, and which entries carry the fields.
- `D/README.md` § What is indexed: the `reference` row becomes `` `~/wigley-agents/decisions.md`, `~/wigley-agents/wiki/**/*.md` ``. The linked folder list gains `~/wigley-agents/wiki`.
- `D/model.py` module docstring stays true. `check_pointers.py` module docstring: name `section_refs.py` as the home of the parser, and keep the pointer rules it states.
- `AGENTS.md` line 21 (`scripts/check_pointers.py`): add that it imports its parser from `plugins/wigley/scripts/docs-index/section_refs.py`.
- `check_pointers.py` scans `D/README.md`, so each `wigley:<name> §` and `decisions.md §` in the new text must name a real heading.

**Version.** `Changing a plugin` in `AGENTS.md` asks for a bump in both manifests in the same commit, and one bump per pushed series. This is the plan's only task in this repo, so this commit carries the bump. Change `version` from `1.16.1` to `1.17.0` in both manifests. If `main` holds a higher version at the start, take the next minor of that version.

**Size and time.** Do not run `docs_index.py build`, `context` or `session` on the real home: `build` writes the shared index, and the installed app still reads schema 4. The tests run on temp homes. The facts, read on 2026-11-05 from the 11:24 index with a scratch model in memory:

- The index is 10,691,435 bytes, with 1,819 entries, 810 of them with a body.
- Headings outside fences: 4,764 `mine`, 1,680 third-party, 6,444 in total. The plan-time count of 7,088 counted lines in fenced code and in follow-up files as well: the same naive count gives 7,112 today, and follow-up files hold 273 of them.
- Links: about 1,180, of which about 840 are markdown and about 340 are section.
- Expected growth: about 1.1 MB (10%), to about 11.8 MB, at `indent=2`. Contexts do not change.
- Expected extra time: under 3 seconds for a full build (810 reads and the resolving).

No cap is needed. No test asserts a size or a time.

GIVEN `~/wigley-agents/wiki/Main.md` WHEN any command runs THEN its entry has kind `reference`, source `global`, and its headings and links
GIVEN a `mine` doc with `` (`~/wigley-agents/decisions.md` § Asking › The agent decides); `` WHEN the index builds THEN the entry holds one `section` link whose `raw` stops at `decides` and whose `targetLine` is the `###` line
GIVEN a `third-party` doc with headings and references WHEN the index builds THEN `headings` holds its headings and `links` is `[]`
GIVEN a hook, a plugin, a script or a follow-up item WHEN the index builds THEN both fields are `[]`
GIVEN a listed file that is gone at read time WHEN the index builds THEN both fields are `[]` and the command exits 0
GIVEN a bad pointer into `decisions.md` WHEN `check_pointers.py` runs THEN it reports the same `<path>:<line>` error as before

Tests: each test builds its own data in a temp tree, as `tests/test_discover.py` does. Each table is one parameterised test with `subTest`. Assert whole lists of dictionaries from `to_json`.

`D/tests/test_section_refs.py`:

- `test_parse_headings_reads_each_level_outside_fences_and_front_matter` — break: fence or front matter read as headings, or a line number off by one. Rows, input → `(level, text, line)`:
  | Input | Expected |
  |---|---|
  | `---⏎# no⏎---⏎# Title⏎##### Deep` | `(1, "Title", 4)`, `(5, "Deep", 5)` |
  | ```` ```⏎## no⏎```⏎## Yes ```` | `(2, "Yes", 4)` |
  | `` ## `Code` **name** ## `` | `(2, "Code name", 1)` |
  | ```` ```x```⏎## After ```` | `(2, "After", 2)` |
  | `#nospace⏎####### seven` | nothing |
  | `# A⏎## B` with `\r\n` breaks | `(1, "A", 1)`, `(2, "B", 2)`, no `\r` in a text |
  | `## A\x0c⏎## B` | `(2, "A", 1)`, `(2, "B", 2)`: a form feed breaks no line |
  | ` ---⏎# no⏎---⏎# Title` (space before the first `---`) | `(1, "no", 2)`, `(1, "Title", 4)`: no front matter |
- `test_walk_headings_takes_the_longest_prefix_and_nests` — break: the shortest match wins, or `›` skips nesting. Headings: `## Asking` line 1, `### The agent decides` line 3, `## Asking twice` line 5, `### Other` line 7. Rows, remainder → `(line, length)` or none:
  | Remainder | Expected |
  |---|---|
  | `Asking twice over` | `(5, 12)` |
  | `Asking › The agent decides; when` | `(3, 26)` |
  | `Asking › Other` | none, with `problem` set |
  | `Askings` | none |
  | `Asking: why` | `(1, 6)` |
- `test_source_length_counts_only_plain_characters_and_keeps_a_closing_mark` — break: a closing backtick is lost, or the end drifts by the emphasis count. Rows, `(remainder, plain_length)` → result:
  | Input | Expected |
  |---|---|
  | `` (`Code` name now, 9) `` | `` `Code` name `` length, 11 |
  | `` (`Code` now, 4) `` | 6 |
  | `(**Bold** now, 4)` | 8 |
  | `(Plain now, 5)` | 5 |
- `test_prose_text_source_returns_the_real_text_of_a_wrapped_range` — break: an offset map ignores a lead or a line break. Rows: `a §⏎  b`, and `> a §⏎> b` keeps `> `, and a range on one line. Assert `source` and `line_of`.

`D/tests/test_doc_fields.py`. The test builds `Entry` values over real temp files, and calls `with_doc_fields`.

- `test_references_give_these_links` — break: a form dropped, `raw` running into prose, or the wrong `targetLine`. Each row is one source doc in a repo, with these targets on disk and each listed as an entry: `decisions.md` under the temp home's `wigley-agents` (`## Asking`, `### The agent decides`), repo-root `AGENTS.md` (`## Running and testing`), `docs/usage/design.md` from the root (`## The right bar`), sibling `README.md` (`## Hooks`), sibling `Terminal.md` (`## Plugin reload`), sibling `other.md` (`## Some heading`), the source itself (`## Mode change`, `` ## `Code` name ``), and a clone skill `writing-tests` (`## One test per behaviour`). Assert `form`, `raw`, target file and `targetLine`:
  | Source text | `form` | `raw` |
  |---|---|---|
  | `(§ Mode change).` | section | `§ Mode change` |
  | `` (`~/wigley-agents/decisions.md` § Asking › The agent decides). `` | section | `` `~/wigley-agents/decisions.md` § Asking › The agent decides `` |
  | `` `docs/usage/design.md` § The right bar — 10 `` | section | `` `docs/usage/design.md` § The right bar `` |
  | `` (`AGENTS.md` § Running and testing) `` | section | `` `AGENTS.md` § Running and testing `` |
  | `` per `wigley:writing-tests` § One test per behaviour: a row `` | section | `` `wigley:writing-tests` § One test per behaviour `` |
  | `(README § Hooks: hooks fail open;` | section | `README § Hooks` |
  | `` `Terminal.md` § Plugin reload). `` | section | `` `Terminal.md` § Plugin reload `` |
  | `` `other.md` §⏎  Some heading, more `` | section | `` `other.md` §⏎  Some heading `` |
  | `` > see `other.md` § Some⏎> heading. `` | section | `` `other.md` § Some⏎> heading `` |
  | `` § `Code` name now `` | section | `` § `Code` name `` |
  | `[t](other.md)` | markdown | `[t](other.md)`, `targetLine` null |
  | `[t](other.md#some-heading)` | markdown | `[t](other.md#some-heading)`, heading line |
  | `[t](other.md#nope)` | markdown | `[t](other.md#nope)`, `targetLine` null |
  | `[t](#mode-change)` | markdown | `[t](#mode-change)`, own file |
  | `[t](~/wigley-agents/decisions.md)` | markdown | as written |
  | `[t](my%20doc.md)`, with a file `my doc.md` | markdown | as written: the path part is unquoted |
  | `[t](/<temp root>/abs/other.md)`, an absolute path | markdown | as written |
  | `[t](wigley:writing-tests)` | markdown | as written, `targetLine` null |
  | `` [`other.md` § Some⏎heading](other.md#some-heading) `` | markdown | the whole span, one link only |
- `test_references_give_no_link` — break: a guess becomes a link, or a form skips the code rule. The source holds `## Own`. `other.md` holds `## 2. Interview impact` and no `Own`. Rows, each expected `[]`:
  `` `other.md` § 2) ``; `§ Nope`; `` `decisions.md` § Asking › Nope ``; `` `missing.md` § Own ``; `` `other.md` § Own `` (no fall-through to the source's own heading); `` `wigley:none` § Own ``; `01 § Own`; `OtherDoc § Own`; `` `§ Own` ``; `` `other.md § Own` ``; `` `[t](other.md)` ``; `![i](other.md)`; `[t](https://example.com/a.md)`; `[t](wiki:all)`; `[t](missing.md)`; `[t](#nope)`; `[t][ref]`; a fenced block that holds `§ Own`.
- `test_a_bare_file_takes_the_nearest_clear_target` — break: a tier order flipped, or a base name guessed. Assert the target path:
  | Tree | Source | Token | Target |
  |---|---|---|---|
  | `a.md` in the folder and at the root | `sub/x.md` | `a.md` | folder |
  | `a.md` at the root and one in another repo | `sub/x.md` | `a.md` | root |
  | one `mine` `a.md` in another repo | `x.md` | `a.md` | that file |
  | two `mine` `a.md` in other repos | `x.md` | `a.md` | none |
  | one `mine` and one third-party `a.md` | `x.md` | `a.md` | the `mine` one |
  | `AGENTS.md` at the roots of two other repos | a doc in no repo | `AGENTS.md` | none |
  | one `README.md` in another repo | `x.md` | `README` | none |
  | one clone of `r`, source in an out-of-repo home of `r` | `f/x.md` | `AGENTS.md` | the clone's |
  | two clones of `r`, source in an out-of-repo home of `r` | `f/x.md` | `AGENTS.md` | none |
- `test_a_skill_pointer_prefers_the_clone_over_the_install` — break: the install wins, or a skill outside `wigley@` matches. Rows: clone and install → clone; install only → install; skill of plugin `other@m` only → none; heading only in a sibling `.md` → none.
- `test_each_entry_carries_the_fields_its_body_allows` — break: a follow-up or hook reads its file, third-party gets links, or a missing file raises. Rows, entry → `(headings, links)`, using a doc that holds `## Own` and `§ Own`:
  | Entry | Headings | Links |
  |---|---|---|
  | `mine` skill-file `a.md` | 1 | 1 |
  | third-party skill `SKILL.md` | 1 | 0 |
  | third-party `a.md`, whose reference targets a `mine` file | 1 | 0 |
  | `hook`, path `settings.json` | 0 | 0 |
  | `plugin`, path a folder | 0 | 0 |
  | `mine` skill-file `a.py` | 0 | 0 |
  | follow-up at `#L3`, `line=3` | 0 | 0 |
  | `mine` entry whose file is gone | 0 | 0 |
  | `reference` entry `Main.md`, with `` # Top ``, `` ##### Deep `` and `` ## `Code` name ``, and a line `[t](wigley:writing-tests)` | 3 | 1 |

  Add one assertion to this test for the whole `headings` list of the first row's entry: a level-1, a level-4 and a backticked heading give `(level, text, line)` in file order, with the backticks gone from `text`.
- `test_a_link_into_a_follow_up_file_resolves_on_its_path` — break: the targets hold only whole-file entries. A doc holds `` `followups.md` § Topic ``. The only entry of that file is an item with `line=3`. Expect one link, with the `## Topic` line.

`D/tests/test_model.py`:

- Change the schema assertion to `5`.
- `test_entry_emits_headings_and_links` — break: a key dropped or renamed. Rows: a default entry gives `[]` and `[]`; an entry with one `DocHeading` and one `DocLink` gives the full dictionaries, with the key `targetLine`.
- `test_doc_link_refuses_an_unknown_form` — break: the check removed. Assert `ValueError`.

`D/tests/test_docs_index.py`:

- Change the schema assertion at line 84 to `5`.
- `test_each_command_emits_the_doc_fields` — break: a command skips `_finished_entries`. Rows `build`, `context <dir>`, `session s1`, over a repo `AGENTS.md` holding `## Own⏎⏎§ Own⏎`. Assert that entry's `headings` and `links`. The `session` row's transcript also loads a file the scan does not find, and that new entry also holds its headings.

`D/tests/test_discover.py`:

- `test_wigley_agents_wiki_files_are_global_reference` — break: the walk removed, the wrong kind, or the repo walk taking the file. `~/wigley-agents` links to a clone under a root, as `test_wigley_agents_archives_are_skipped_by_the_global_and_repo_walks` builds it. Files: `wiki/Main.md` and `wiki/sub/page.md`. Assert kind `reference` and source `global` for both.

`scripts/tests/test_check_pointers.py`:

- Every existing test stays, with no edit. They prove that the move keeps the checker's behaviour.
- `test_inline_triple_backticks_open_no_fence` — break: `prose_lines` drops the code span rule. A skill holds ```` ```x``` ````, then a pointer with a heading that does not exist. Expect one error.

Done when:

- `grep -n 'SCHEMA_VERSION = 5' plugins/wigley/scripts/docs-index/model.py` prints one line.
- `grep -n 'DECISIONS_POINTER\|SKILL_POINTER\|def longest_prefixes\|def read_headings' scripts/check_pointers.py` prints nothing.
- Each command below passes from the worktree root:
  ```
  (cd plugins/wigley/scripts/docs-index && python3 -m unittest discover)
  (cd scripts && python3 -m unittest discover -s tests)
  python3 scripts/check_pointers.py
  python3 scripts/check_manifests.py
  python3 scripts/check_manifests.py --against origin/main
  ```

Commit:    one commit in wigley-ai-marketplace for the group, on the run's worktree branch, the version bump included. Do not push: both repos land together (`plan.md` § Architecture).

## Proof

