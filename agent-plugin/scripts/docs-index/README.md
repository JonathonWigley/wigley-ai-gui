# Docs index

**Contents**

- **Commands** — `build`, `context <dir>` and `session <id>`, the `--contributions` option, and
  what each prints or writes.
- **Config** — the machine-local file that picks the repos.
- **Contributions file** — the global folders, skill link prefixes and features homes the app hands
  the index.
- **What is indexed** — every kind, where it is found, and its `source`.
- **The index file** — the JSON schema the wigley-ai-gui docs browser reads.
- **Headings and links** — which entries carry them, the reference forms, the target rules and `raw`.
- **Load states** — the five states and the Claude Code and Codex rules behind them.
- **Last loaded** — when a session last loaded each entry, read from Claude Code transcripts, and
  the cache that keeps the read incremental.
- **Local commands** — the test suite.

`docs_index.py` finds every agent doc on the machine — instruction files and their imports, rules,
skills, subagents, commands, hooks, plugins — plus the user's work tracking in the
feature homes (features, plans, follow-ups), and records for a folder or a live session which
of them Claude Code and Codex load. Its output is the input of the wigley-ai-gui docs browser, so
the schema below is a contract: a change to it bumps `schemaVersion`.

Standard library only, Python 3.11 or later (`tomllib`).

## Commands

| Command                                | Writes                                                                          | Prints                                        |
| -------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------- |
| `python3 docs_index.py build`          | `~/.agents/wigley-docs/index.json` (temp file, then rename) and the loads cache | nothing                                       |
| `python3 docs_index.py build --stdout` | the same files                                                                  | the same JSON                                 |
| `python3 docs_index.py context <dir>`  | the loads cache                                                                 | an index document for `<dir>` alone           |
| `python3 docs_index.py session <id>`   | nothing                                                                         | an index document for one Claude Code session |

Each command takes `--contributions <file>` before the command name
(`docs_index.py --contributions <file> build`): the file the app writes with the global folders,
skill link prefixes and features homes (Contributions file). Without it the index walks no global
folder, resolves no skill link and finds no feature home.

- `build` indexes every discovered repo, the global layer, the active plugins and every feature
  home, with one folder context per repo root and one for the home folder.
- `context <dir>` scans live, not from `index.json`: the global layer, the active plugins, the
  outermost repo that holds `<dir>` (walked whole, nested repos included) and the feature home of
  each repo that holds it, with one folder context for `<dir>`. When that outermost repo is ignored,
  no repo is walked and none of its files is indexed, the instruction files of `<dir>`'s ancestors
  included. A `<dir>` in no repo walks every config root at or below it (or `<dir>` itself when it
  sits under a root) instead, so its context holds the repos below it as `build`'s home context
  does. A `<dir>` that is no folder exits 1 with the reason on stderr. Whatever it walks, it also
  finds every marketplace clone under the config roots (folder listings only, links not followed,
  ignored repos skipped), so an installed plugin with a source reads as `mine` outside its clone too.
- `session <id>` reads the transcript `<dir>/projects/*/<id>.jsonl`, `<dir>` the first of `claudeConfigDirs`
  holding it, takes the session's folder
  from its rows' `cwd`, scans as `context` does, and records the states and the last-loaded times
  the transcript shows (Last loaded). The id
  is the Claude Code session id, which the forms relay sends to wigley-ai-gui as `session_id`. An
  id with no transcript, or a transcript with no `cwd`, exits 1 with the reason on stderr.

A Claude Code settings file, `installed_plugins.json` or `~/.codex/config.toml` that is unreadable
reads as empty, and a value in one of the wrong shape reads as its default; each prints one stderr
line naming the file, and the key for a value, and the command runs on.

Nothing rebuilds the index on its own: the user, an agent or the app runs `build`.

## Config

`~/.agents/wigley-docs/config.json`, machine-local. Any command writes it with the defaults when it
is absent. A key the file leaves out takes its default; a key of the wrong shape (`roots` or `ignore`
not a list of strings, `claudeConfigDirs` not a non-empty list of strings) prints one stderr line naming it and takes its
default; a key the index does not read (an older file's `featuresHome`) is ignored without a line; an unreadable or non-object file prints one stderr line, runs on the defaults and is left as
it is. A leading `~` or `~/` in any of these paths, as in an `@import` or a `[[skills.config]]` path,
means the home folder; `~user/...` is not expanded. `roots` defaults to none, since where repos
are cloned differs per machine: while it is empty, every command prints one stderr line naming
this file, and each machine adds its own folders. The defaults:

```json
{
  "roots": [],
  "ignore": [],
  "claudeConfigDirs": ["~/.claude"]
}
```

- `roots` — every git repo under each root is indexed, nested repos and submodules included (a
  folder holding `.git`, as a folder or a file). A linked git worktree — a `.git` file whose
  `gitdir:` names a folder holding `commondir`, as `git worktree add` makes — is skipped as an
  ignored repo is, everywhere a repo is; a submodule's `.git` file names a `.git/modules/` folder,
  which holds none, so a submodule stays indexed.
- `ignore` — glob patterns (`fnmatch`, `~` expanded) matched against a repo's absolute root; a match
  drops that repo and every repo inside it. Retired and third-party repos go here.
- `claudeConfigDirs` — every Claude Code config folder on the machine (`CLAUDE_CONFIG_DIR` picks one
  per session; `~/.claude` when it is unset). Each folder's files are indexed as part of the global
  layer, wherever this README names `~/.claude`. `build` and `context` judge Claude Code's load
  states against the first folder; `session` searches every folder's `projects/` for the transcript
  and judges against the folder that holds it.

## Contributions file

The app writes it from the installed plugins' `auri.json` (its `docs` sections merged, and the
picked `backlog` section's homes) and passes its path as `--contributions` on every run. JSON, these
keys and no others:

```json
{
  "version": 1,
  "globalFolders": [
    {
      "path": "~/agents",
      "referenceFiles": ["decisions.md"],
      "subfolders": ["learning", "wiki"],
      "skip": ["archive", "learning/archive"]
    }
  ],
  "linkPrefixes": { "me:": "me@my-marketplace" },
  "features": {
    "homes": ["{repo}/docs/features", "~/features/{name}"],
    "file": "followups.md",
    "areaFolder": "followups"
  }
}
```

- `globalFolders` — folders of the global layer, walked in order. `path` is `~` or absolute. Each
  top-level `.md` file is `instructions`, except a name in `referenceFiles`, which is `reference`.
  Each of `subfolders` is walked in full: one whose last part is `learning` gives `learning`
  entries, any other `reference`. Each of `skip`, a path below `path`, is left out of every walk,
  matched by real path.
- `linkPrefixes` — each skill link prefix, ending in `:`, mapped to the plugin key whose skills it
  names (Headings and links).
- `features` — where the feature homes sit, or `null` for none. `homes` holds folder templates: an
  **in-repo** template `{repo}/<relative path>` (no `..`, no other `{…}`) names a folder below a
  repo's root; an **out-of-repo** template `<~ or absolute folder>/{name}` (no other `{…}`) names a
  folder holding one home per repo name. `file` is a home's follow-ups file; `areaFolder`, or
  `null`, its folder of per-area follow-up files.

A leading `~` expands against the home folder. A missing, unreadable or malformed file (not an
object, `version` not 1) reads as no file, after one stderr line naming it; a field or template of
the wrong shape is dropped, after one stderr line naming it.

A **feature home** is one repo's features, plans and follow-ups: `<folder>/<repo>/` for each
out-of-repo template's folder, or the repo's own folder at an in-repo template's path when that
folder is a plain folder below the repo root. Templates are tried in order. A repo that gathers
several projects, one per folder directly under its root with its own `AGENTS.md`, has a home in
each such project folder's plain folder at that path as well, named for the project folder. The
same path deeper down is ordinary repo content. An in-repo home is found by the repo walk, so it is
indexed only when its repo is. A home reached through a linked folder is not indexed as a home, and
neither is a folder on the way that is a repo or submodule of its own: that one is its own repo. The
out-of-repo home is shared by every clone of its repo; an in-repo home belongs to its own clone.

## What is indexed

Every file below is listed whether or not any session loads it; the load state says whether it does.
Generated folders are skipped: `node_modules`, `Library`, `build`, `dist`, `out`, `obj`, `Temp`,
`Logs`, `.git`, `__pycache__`, `.venv`, `venv`, `PackageCache`, `.claude/worktrees`. Inside a
repo's own `.claude` or `.agents` folder, a folder linked into one, and anywhere under a feature
home only `.git`, `node_modules` and `.claude/worktrees` are skipped, so a skill or feature named
`build` is indexed. A repo nested in another repo's `.claude` or `.agents` is measured from its
own root, so its generated folders are skipped. A skill's folder is the exception: its
`skill-file` walk skips every generated folder above, wherever the skill sits.

| Kind           | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `instructions` | `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `AGENTS.override.md`, `.claude/CLAUDE.md`, `.claude/AGENTS.md` at any depth; the same files in each ancestor of a context folder that sits in no indexed repo (`source: global`); every file an `@import` reaches outside an ignored repo; `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.codex/AGENTS.override.md`; the top-level `.md` files of each global folder but its `referenceFiles`; the root `CLAUDE.md` and `AGENTS.md` of a Claude Code plugin |
| `reference`    | each global folder's `referenceFiles`, and every `.md` below each of its `subfolders` but a `learning` one                                                                                                                                                                                                                                                                                                                                                                                                 |
| `learning`     | every `.md` below a global folder's `learning` subfolder                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `rule`         | `.claude/rules/**/*.md`, `~/.claude/rules/**/*.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `skill`        | `*/SKILL.md` under `.claude/skills/`, `.agents/skills/`, `~/.claude/skills/`, `~/.claude/skills/synced/<bucket>/`, `~/.agents/skills/`, and a plugin's `skills/`                                                                                                                                                                                                                                                                                                                                           |
| `skill-file`   | every other file in a skill's folder, at any depth (references, templates, scripts), generated folders skipped, and a file holding a NUL byte in its first 8 KiB skipped; an instruction file there (`AGENTS.md` …) stays `instructions`                                                                                                                                                                                                                                                                   |
| `subagent`     | `.claude/agents/*.md`, `~/.claude/agents/*.md`, a plugin's `agents/*.md`                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `command`      | `.claude/commands/**/*.md`, `~/.claude/commands/**/*.md`, a plugin's `commands/**/*.md`                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `prompt`       | `~/.codex/prompts/*.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `hook`         | each hook in the `hooks` object of a `settings.json` / `settings.local.json`, and of a plugin's `hooks/hooks.json`                                                                                                                                                                                                                                                                                                                                                                                         |
| `plugin`       | each Claude Code install in `~/.claude/plugins/installed_plugins.json`, and each Codex plugin in `~/.codex/config.toml`                                                                                                                                                                                                                                                                                                                                                                                    |
| `annotation`   | `.claude/annotations.*.local.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `feature`      | `<home>/<slug>/checklist.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `task`         | numbered task docs `NN-*.md` in a feature folder or a `plan-*/` folder                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `plan`         | `<home>/<slug>/plan-*/plan.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `feature-doc`  | any other `.md` under `<home>/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `followup`     | one entry per item of `<home>/<file>`, `<home>/<areaFolder>/*.md` and a repo's `docs/followups/*.md`                                                                                                                                                                                                                                                                                                                                                                                                       |

`<home>` is a feature home (Contributions file), and `<file>` and `<areaFolder>` the `features`
fields. Its files are `source: features` with the repo's name as `repo` (the
project folder's name for a project folder's home) and the home folder's real path as `root`,
wherever it sits. An instruction file (`AGENTS.md`, `CLAUDE.md` …) under an in-repo home stays
`instructions` with `source: repo`, its owner the home's repo, found by looking past the home.

- Every walk skips each global folder's `skip` folders, matched by real path, so a repo walk over a
  clone a global folder links to skips them too.
- A path reached twice (a symlink, a global folder also sitting under a root) is one entry, under
  its real path. Its owner does not depend on which walk reached it first: by the plugin
  install or feature home holding the real path, when that is the deepest owner folder holding it;
  else `global` when a global walk reached it, whatever repo the real path sits in; else by the
  deepest repo holding the real path (found by a repo walk, or holding a symlink's target), unless
  the real path sits in an ignored repo; else by the walk that reached it; else, for a file only an
  `@import` reached, `global`. Each other path the file
  was reached by is exported in `walked`; the owner of the walk that reached it there is kept
  outside the JSON.
- Every walk follows a symlinked folder one level deep (a link inside it is not followed): the
  global walk's `~/.claude/rules`, `~/.claude/commands` and each global folder's subfolders, a
  plugin's
  `commands`, the feature homes, and a repo walk inside a repo's own `.claude`, `.agents` or
  in-repo feature home, so a linked `.claude/skills` or per-skill link is reached. Those folders
  are measured from the root of the repo being walked: a repo nested in another repo's `.claude`
  or `.agents` (a submodule at `.claude/skills/x`) is not inside an agent folder of its own. A
  linked folder on the way to an in-repo home is not followed, so a home is always a plain folder. The glob-shaped paths (`~/.claude/skills/*/SKILL.md` and the like) follow links too.
- Plugin files come from the active version only: the `installPath` in `installed_plugins.json` for
  Claude Code, and the highest version folder under `~/.codex/plugins/cache/<marketplace>/<plugin>/`
  for Codex. A Codex plugin contributes its `skills/` only.
- A clone holding `.claude-plugin/marketplace.json` is a **marketplace clone**: each plugin it lists
  is walked from its `source` folder as a plugin's install folder is (Codex's `skills/`-only rule
  aside), its files `source: repo` with the clone's `repo` and `root`, and `plugin` the
  `<plugin>@<marketplace>` key, `<marketplace>` the file's `name`. Only a listed item with a `name` and a
  `./` `source` resolving to a folder inside the clone is walked; the first item of a name wins.
- An installed plugin **has a source** when its marketplace's git URL — `known_marketplaces.json`
  in each Claude config folder's `plugins/` for Claude Code, `[marketplaces.<name>] source` in
  `~/.codex/config.toml` for Codex — names the same repo as a marketplace clone's `origin`: the
  `<owner>/<repo>` part of both URLs, `.git` dropped, compared case-insensitively, so an SSH host
  alias and an `https` URL match. The first such clone in walk order is the source; when it walks no
  plugin of that name (above), the install has no source. Each of that
  install's files whose path below the install folder, with its `#hook:` fragment, matches a file
  of the plugin in the source is **merged** into the source's entry: the install's entry leaves the
  document, and the source entry carries it in `meta.installed` and takes its load states. An
  install file with no match in the source stays an entry of its own (`source: plugin`, `owner:
  mine`): installed only.
- A file under a root but inside no repo is skipped.
- Follow-up files come in three shapes, read by the first that fits:
  - a repo's `docs/followups/<topic>.md` is one item, the whole file, titled by its `# ` heading
    (else the file name), always `open`, at `line` 1; its `README.md` is not indexed;
  - a file with a `**Contents**` list, any `### ` heading, or a `## ` section holding body text and
    no top-level list item is one item per `## ` heading;
  - any other file is one item per top-level list item (`- ` or `1. ` at column 0), titled by its
    bold lead, backticks kept and uncut, or its first sentence (a trailing `.` dropped), with the
    `## ` heading above it as its section. Title, tags and gist come from the item's first line,
    read on across its indented continuation up to the line that closes a bold title the first line
    opens (the lines joined with single spaces); the rest of the continuation is not read.
    An item's tags are the comma-separated words of an italic span (`*…*` or `_…_`) that opens its
    text after the title and ends in a colon (`- **Title** — *agent-ready*: gist`), read from the
    item's Contents line for a `## ` item and from the list item's first line for a list item; the
    span is left out of the gist. A `## ` item's Contents line is a top-level list item between
    `**Contents**` and the first `## ` heading, its indented continuation lines read as part of it
    (joined with single spaces): the first one whose title matches the heading,
    backticks and strike-through removed from both for the match. A tag span on the `## ` heading or
    in the section's body is not read. A repo's
    `docs/followups/<topic>.md` item has no tags. An item whose text after the title, tags
    removed, begins with `shipped`, or that is struck through (`~~` at the start of its text or
    heading), is `done`; for a `## ` item the text after the title is the first
    non-heading line under it. A `README.md` in a feature home's `followups/` is an index, not
    follow-ups: it is a `feature-doc`.

## The index file

All three commands print or write one document:

```json
{
  "schemaVersion": 5,
  "generatedAt": "2026-10-19T14:02:11Z",
  "entries": [
    {
      "id": "/Users/u/dev/notes/docs/features/followups.md#L10",
      "kind": "followup",
      "source": "features",
      "owner": "mine",
      "repo": "notes",
      "root": "/Users/u/dev/notes/docs/features",
      "plugin": null,
      "path": "/Users/u/dev/notes/docs/features/followups.md",
      "line": 10,
      "title": "bash-lint command splitter: redesign it or check less",
      "meta": {
        "status": "open",
        "gist": "paren, redirect and `$(` gaps …",
        "section": null,
        "tags": ["needs a feature plan"]
      },
      "walked": [],
      "lastLoaded": "2026-10-26T21:01:32.174Z",
      "headings": [],
      "links": []
    }
  ],
  "contexts": [
    {
      "folder": "/Users/u/Documents/dev/tool",
      "sessionId": null,
      "loadedPlugins": {},
      "states": {
        "/Users/u/Documents/dev/tool/AGENTS.md": {
          "claude": {
            "state": "launch",
            "reason": "AGENTS.md in an ancestor of the folder; no CLAUDE.md above it"
          },
          "codex": {
            "state": "launch",
            "reason": "AGENTS.md between the git root and the folder"
          }
        }
      }
    }
  ]
}
```

**Entry**

- `id` — the real path, with `#L<line>` for an item inside a file and `#hook:<event>:<n>` for a
  hook. Unique in the document.
- `source` — `global`, `repo`, `plugin` or `features`, from the owner of the real path (see What is
  indexed). A global folder is `global`, since sessions get it through `~/.claude/CLAUDE.md`'s
  imports; it stays `global` when it links to a clone, even one under a root whose repo walk also
  reaches its files. A consumer accepts a `kind` or `source` value it does not know: wigley-ai-gui's
  docs browser loads such entries and groups them under a title made from the id.
- `owner` — `third-party` for every entry of an installed plugin with no source (see What is indexed),
  its `plugin` entry included,
  and for a synced skill (`<config folder>/skills/synced/`), its skill files included; `mine` for
  every other entry: the global layer, every repo and feature home, and an installed-only file of a
  plugin that has a source. A `third-party` file is replaced on its next update or sync, so the docs
  browser opens it read-only.
- `repo` — the origin repo's name (`basename -s .git` of the `origin` URL, else the folder name),
  shared by every clone of a repo and by its feature homes. `null` for `global` and `plugin`.
- `root` — the clone, feature home, or plugin install folder the entry belongs to; `null` for
  `global`.
- `plugin` — `<plugin>@<marketplace>` for `source: plugin` and for a marketplace clone's plugin
  files, else `null`.
- `line` — 1-based line of an item inside a file, lines splitting on `\n` alone, else `null`.
- `walked` — every other path a walk reached the entry's file by, through a symlinked file or
  folder, in walk order; `[]` when only the real path reached it. The docs browser trashes the link
  behind each one along with the file.
- `lastLoaded` — the `timestamp` text, unchanged, of the latest transcript row that loads the entry (Last
  loaded): ISO 8601 with a UTC offset, usually `Z`. `null` when no transcript read shows one, and always for a `hook` or `plugin`.
- `headings` — `[{ "level": int, "text": str, "line": int }]`: the file's headings at all six levels
  in file order (Headings and links). `line` is 1-based in the file; `text` has its closing hashes,
  backticks and `*` removed. `[]` for an entry with no body.
- `links` — `[{ "form": "markdown" | "section", "raw": str, "target": str, "line": int, "targetLine": int | null }]`:
  the file's outgoing references in source order, duplicates kept (Headings and links). `raw` is the
  source text of the reference, each line break read as `\n`, `target` the real path of the target
  file, `line` the 1-based source line `raw` starts on, and `targetLine` the target heading's 1-based
  line, or `null` when the link names a file only. `[]` for an entry with no body and for a
  `third-party` entry.
- `title` — the skill or subagent `name` (else its folder or file name), the first `# ` heading, or
  the file name; a `skill-file`'s path below its skill's folder (`/`-separated); a follow-up item's title; `<event> <matcher> → <program>` for a hook; the
  `<plugin>@<marketplace>` key for a plugin.
- `meta` by kind:

  | Kind           | `meta`                                                                                                                                                                                                           |
  | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `skill`        | `name`, `description`, `userInvokedOnly` (`disable-model-invocation: true`), `implicitInvocation` (Codex `agents/openai.yaml`)                                                                                   |
  | `subagent`     | `name`, `description`, `model`                                                                                                                                                                                   |
  | `rule`         | `paths` (the `paths:` globs, `[]` when unscoped)                                                                                                                                                                 |
  | `instructions` | `imports` (the paths its `@import` lines resolve to)                                                                                                                                                             |
  | `hook`         | `event`, `matcher` (`null` when the group has none), `command`                                                                                                                                                   |
  | `plugin`       | `harness` (`claude` or `codex`), `version`, `enabled` (Codex only), `installs` (Claude only: `[{scope, projectPath}]`, one per distinct pair among the installs sharing this folder, across every config folder) |
  | `feature`      | `slug`, `checked`, `total`                                                                                                                                                                                       |
  | `task`         | `feature`, `plan` (the plan slug, or `null`), `status`, `checked`, `total`                                                                                                                                       |
  | `plan`         | `feature`, `checked`, `total`                                                                                                                                                                                    |
  | `followup`     | `status` (`open` or `done`), `gist`, `section` (the `## ` heading above a list item, else `null`), `tags` (the item's tags in written order, `[]` when none)                                                     |
  | `skill-file`   | `skill` (the id of its skill's `SKILL.md` entry)                                                                                                                                                                 |
  | others         | `{}`                                                                                                                                                                                                             |

  A marketplace clone's plugin file of any kind also carries `installed`: one
  `{harness, version, path}` per install folder merged into it, Claude Code's (in config folder
  order) before Codex's (`path` the install's copy of the file, a real path; `harness` and
  `version` from the folder's first install). `[]` when no install holds the file: not yet installed.

  A frontmatter value written on several lines — folded (`key: >-`), literal (`key: |`) or as
  indented continuation lines — is read whole.

**Context**

- `folder` — the real path of the folder the states were computed for: a repo root or the home
  folder in `build`, the given folder in `context`, the session's `cwd` in `session`.
- `sessionId` — the Claude Code session id for `session`, else `null`.
- `loadedPlugins` — `<plugin>@<marketplace>` → the version the session loaded, read from the install
  folder (`…/cache/<marketplace>/<plugin>/<version>`) of each plugin file the transcript names, a
  skill's base directory among them, the last named version winning; a plugin the transcript names
  no file of is absent. `{}`
  outside `session`.
- `states` — entry id → harness (`claude`, `codex`) → `{state, reason}`. A context holds the global
  and plugin entries, the entries of each repo that holds the folder (an enclosing repo included)
  or is nested below it (its files reach the folder on demand), the in-repo feature home of each of
  those repos, and the out-of-repo feature home named for each repo that holds the folder (every
  clone of that repo shares it; another clone's in-repo home is left out). An entry reached through a symlink is in it also when the place it is
  linked from would be (a skill linked from repo `b` into repo `a` is in both repos' contexts); an
  entry absent from it does not reach that folder. A `session`
  context holds the same entries for the session's `cwd`, plus each file the transcript loaded,
  found by the scan or not, with `claude` only.

## Headings and links

`doc_fields.py` fills both fields on every command's entries; `section_refs.py` holds the § parser,
of which the wigley marketplace's `scripts/pointer_parser/section_refs.py` (read by its
`scripts/check_pointers.py`) is a copy.

**Which entries carry them.** An entry has a body when `line` is `null`, its kind is not `hook` or
`plugin`, and `path` ends in `.md`.

| Entry                                                                    | `headings` | `links` |
| ------------------------------------------------------------------------ | ---------- | ------- |
| `mine`, with a body                                                      | parsed     | parsed  |
| `third-party`, with a body                                               | parsed     | `[]`    |
| `hook`, `plugin`, a file not ending in `.md`                             | `[]`       | `[]`    |
| a follow-up item, `#L1` of a repo's `docs/followups/<topic>.md` included | `[]`       | `[]`    |
| a file that cannot be read                                               | `[]`       | `[]`    |

So no entry holds the headings or links of a follow-up file, while a reference into one resolves,
since its items list its path.

**What is read.** A file splits into lines on `\n` alone, one trailing `\r` dropped from each, so
`line` and `targetLine` name the docs browser's lines; a lone `\r` stays inside its line. Fenced code
and the front matter are blank: front matter opens on a first line that is `---` with only spaces or
`\r` after it, and ends at the next such line. A heading's closing `#` run needs whitespace before
it, so `## C#` reads `C#` and `## C# ##` reads `C#`. A line break, with the whitespace and `>` markers
around it, reads as one space, so a reference can wrap; a blank line ends the text a heading can
match, and no reference crosses it. A code span is seen one source line at a time.

**Reference forms**, found in this order:

1. **Markdown link**: `[text](href)` with its `[` outside a code span, all in one paragraph; `form`
   `markdown`, `raw` from `[` to `)`. Its whole span is closed to the forms below, also when it gives
   no link. An image and a reference-style link give none.
2. **File or skill pointer**: a path ending in `.md`, `README` or `<prefix><skill>` for a
   `linkPrefixes` key (the longest that fits), backticks
   optional, then whitespace in the same paragraph and `§ `, with the `§` outside a code span; `form`
   `section`. One that resolves to nothing gives no link and does not fall through to form 3.
3. **Bare `§`**: any other `§ ` outside a code span, targeting the entry's own file; `form`
   `section`. Two digits or a CamelCase word just before it in the same paragraph (a task number, a
   file stem) name another file the index cannot pin, and give no link.

**Section target.** The text after `§ `, backticks and `*` removed, must start with a heading of the
target at any level, as a whole word; the longest wins, and each `›` walks into the children of
the heading before it. No match gives no link, nor does a target that does not end in `.md` or
cannot be read. `targetLine` is the first of the deepest tied headings.

**Target rules for a file token.** A candidate counts only when its real path is the `path` of a
listed entry of a kind other than `hook` and `plugin`. First hit wins:

| Token             | Tried                                                                                                                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `~/…`             | that path                                                                                                                                                                                                                         |
| `/…`              | that path                                                                                                                                                                                                                         |
| holds a `/`       | the source's real folder, the repo root                                                                                                                                                                                           |
| bare `name.md`    | the source's real folder, the repo root, then the one `mine` path with that base name, when exactly one exists                                                                                                                    |
| `README`          | as `README.md`: the source's real folder, the repo root                                                                                                                                                                           |
| `<prefix><skill>` | that skill's `SKILL.md` among `skill` entries whose `plugin` equals `linkPrefixes[<prefix>]`: the first by path with `source` `repo`, else the first by path with `source` `plugin`. A heading in a file beside it gives no link. |

The repo root is the nearest one holding the source's real folder. A `source: features` entry in no
repo tries the token under the `root` of each `source: repo` entry of the same `repo`, and resolves
only on exactly one listed hit.

**Markdown hrefs.** The href splits at its first `#`, and its path part is URL-decoded.

| Href                                                                       | Result                                                         |
| -------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `<prefix><skill>`, for the longest `linkPrefixes` key the href starts with | the skill rule above, the part before `#`, `targetLine` `null` |
| any other scheme                                                           | no link                                                        |
| `~/…` or `/…`                                                              | that path                                                      |
| any other path                                                             | relative to the source's real folder only                      |
| `#fragment` alone                                                          | the source's own file; an unmatched fragment gives no link     |

A fragment matches the target's first heading whose GitHub slug equals it (lowercase, alphanumerics,
spaces, `-` and `_` kept, each space then a `-`). On a path href, an unmatched fragment or a target
not ending in `.md` keeps the link, with `targetLine` `null`.

**`raw`** is the text a page finds in the source, backticks included. A pointer's starts at its
token, with an opening backtick; a bare link's at `§`. A section link's ends at the end of the
matched heading text, with a closing backtick or `*` run the text left open, and prose after it
stays out. A wrapped reference keeps its line break, read as `\n` also in a CRLF file, and its lead.

## Load states

| State        | Meaning                                                                               |
| ------------ | ------------------------------------------------------------------------------------- |
| `launch`     | in context from the session's start                                                   |
| `on-demand`  | loads when the session touches a matching file or folder, or when the user invokes it |
| `listed`     | its name and description are in context; the body loads on use                        |
| `shadowed`   | would load, but another file switches it off                                          |
| `not-loaded` | the harness never loads it for this folder                                            |

`reason` names the rule in one line. A file reached through a symlink is judged at its real path and
at each path it is linked from, each by its own owner — the real path by the entry's owner, a linked
path by the owner of the walk that reached it there, plugin membership and enablement included — and
takes the state that loads soonest: a `~/.claude/CLAUDE.md` or user skill linked from a dotfiles
clone reads as the user file it stands in for, an enabled plugin's skill linked into a repo reads as
the plugin's, and a user skill linked into a plugin's cache reads as a user skill. For Claude Code, work tracking (`feature`, `task`, `plan`,
`feature-doc`, `followup`), `reference`, `learning` and `annotation` entries are `not-loaded`,
reason `agents read <kind> files on a pointer`, unless an `@import` reaches them; so are
`skill-file` entries for both harnesses, reason `agents read skill files on a pointer`. A merged
entry is judged at its own path and at each `installed` path, each by its own owner, and takes the
state that loads soonest, as a linked path is. Any entry no rule
below reaches is `not-loaded`, reason `no load rule reaches this file`. Every file under `~/.codex`,
every Codex plugin file and every `prompt` is `not-loaded` for Claude Code, reason `Codex file`; for
Codex, a `CLAUDE.md`, a file under `.claude/` or in a Claude config folder, and a Claude Code plugin file are
`not-loaded`, reason `Claude Code file`. In `build` and `context`, a file in a Claude config folder other than the
first of `claudeConfigDirs` — `~/.claude` counting as one whether or not `claudeConfigDirs` lists it — is `not-loaded` for Claude Code, reason `in Claude config folder <folder>; states are
judged against <first folder>` (both written with `~`), such as `in Claude config folder ~/.claude; states are judged
against ~/.claude-personal`; a plugin's files are judged as the plugin's even when its cache sits in a config folder.

**Claude Code**, for a folder `F` in repo `R`:

- `~/.claude/CLAUDE.md`, and each file its `@import`s reach (four hops), are `launch`.
- `CLAUDE.md`, `.claude/CLAUDE.md` and `CLAUDE.local.md` in `F` and each ancestor are `launch`; the
  home folder's `.claude/CLAUDE.md` is the user file above, not a project file. Below `F` they are
  `on-demand`.
- `AGENTS.md` and `.claude/AGENTS.md` follow `pluginConfigs."cc-plugin-agents-md@builtin".options.instructionFiles`
  in `~/.claude/settings.json`:
  - `claude-md-or-agents-md` (the default, and what any unrecognised value means): `shadowed` when
    a project `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` exists in `F` or an ancestor,
    the reason naming the first one found; otherwise `launch` in `F` and its ancestors, and
    `on-demand` below `F` unless their own folder holds one of those files (`shadowed`). The
    ancestor walk runs to the filesystem root, not the repo root.
  - `claude-md-and-agents-md`: never `shadowed`.
  - `claude-md` and `managed-only`: `not-loaded`.
  - An `AGENTS.md` outside `F`'s ancestors and subtree is `not-loaded` in every mode.
- A file an `@import` reaches takes its importer's state, four hops deep.
- Rules in `~/.claude/rules` and in `.claude/rules` of `F` and its ancestors are `launch` without
  `paths:` and `on-demand` with it. Rules elsewhere are `not-loaded`.
- Skills in `~/.claude/skills`, the synced skills, and `.claude/skills` of `F` and each ancestor up
  to `R` are `listed`; below `F` they are `on-demand`. A skill with `disable-model-invocation: true`
  is `on-demand`. A skill in `.agents/skills` is `not-loaded` unless a `.claude/skills` folder or a
  skill folder in one links to it, and then takes the state of where it is linked from.
- Subagents and commands in `~/.claude` and in `.claude` of `F` and each ancestor up to `R` are
  `listed`.
- Plugins: a plugin is enabled when the last of `~/.claude/settings.json`,
  `R/.claude/settings.json` and `R/.claude/settings.local.json` that names it in `enabledPlugins`
  sets it `true`, and an install of it applies: scope `user`, or scope `project` or `local` whose
  `projectPath` is `R`. An enabled plugin's entry and hooks are `launch`; its skills, subagents and
  commands are `listed` (a skill with `disable-model-invocation: true` is `on-demand`). A disabled
  plugin's files are `not-loaded`, and so are instruction files inside a plugin. These judge a file
  at each location the plugin owns: its install folder, or a path its walk reached through a link.
- Hooks in those three settings files are `launch`.

**Codex**, for a folder `F` in git repo `R`:

- In `~/.codex`, the first of `AGENTS.override.md` and `AGENTS.md` whose text is not blank (empty
  or whitespace only) is `launch`; the other is `not-loaded`.
- In each folder from `R` down to `F` (`F` alone outside a repo), the first of
  `AGENTS.override.md`, `AGENTS.md` and the `project_doc_fallback_filenames` in
  `~/.codex/config.toml` that exists is `launch`, and the rest of that folder's are `not-loaded`; a
  blank winner is `not-loaded` and the folder loads nothing. A fallback name that is empty, `.`,
  `..`, or holds a `/` is skipped. Files above `R` or below `F` are `not-loaded`. Once the project
  files before it reach `project_doc_max_bytes` (32 KiB by default; the `~/.codex` file and a blank
  file do not count), a file is `not-loaded` with that reason.
- Codex has no imports, and reads no `CLAUDE.md` and nothing under `.claude/` except through a
  symlink into `.agents/`, or a file named in `project_doc_fallback_filenames`, which is a candidate
  like any other.
- Skills in `.agents/skills` of `F` and each ancestor up to `R`, in `~/.agents/skills`, and in the
  enabled plugins are `listed`; one whose `agents/openai.yaml` sets
  `policy.allow_implicit_invocation: false` is `on-demand`, and one disabled by a `[[skills.config]]`
  entry with `enabled = false` is `not-loaded`.
- Prompts in `~/.codex/prompts` are `on-demand`.
- A plugin is enabled when `[plugins."<plugin>@<marketplace>"]` sets `enabled = true`.

**Session**: the transcript's first `instructions` attachment gives the `launch` files; later
`instructions` and `nested_memory` attachments give `on-demand` files that have loaded; the
`skill_listing` names and `agent_listing_delta` types give `listed` skills, commands and subagents
(a name listed at any point in the session counts, even if a later delta removes it),
matched by the listing's spelling at any of the entry's locations (a command's file name without
`.md`, also for a command in a subfolder; `<plugin>:<name>` where a plugin owns the location, an
install's or a marketplace clone's plugin folder;
`anthropic-skills:<name>` for a synced skill); a file the transcript loaded by path keeps that state over a listing. Every other
entry is `not-loaded`, reason `not in this session's transcript`, except `hook` and `plugin`
entries, which the transcript does not record and the session context leaves out. A file the
transcript loaded always gets its state, even when it sits outside the entries that reach the
session's folder. A loaded file the scan did not find becomes a new `instructions` entry.

## Last loaded

An entry's `lastLoaded` is the latest `timestamp` among the transcript rows that load it. `build`
and `context` read every Claude Code transcript on the machine; `session <id>` reads that session's
transcript and its subagents' alone, so its times are the session's own.

**Transcripts**: in each of `claudeConfigDirs`, `projects/*/*.jsonl` (main sessions) and
`projects/*/*/subagents/**/*.jsonl` (subagents and workflow agents, `journal.jsonl` excepted). For
`session <id>`: `<id>.jsonl` and `<id>/subagents/**/*.jsonl` beside it. A transcript that cannot
be read (gone since it was listed, or refused) is skipped, by every command. Codex sessions record no
list of loaded files and are not read.

**Loads**: a row whose top-level `timestamp` is absent, does not parse as ISO 8601, or carries no UTC
offset is skipped (`api-request-blob` rows repeat tool calls without a timestamp). Each of these counts
as a load at its row's `timestamp`, kept as written:

| Row                                                        | Loads                                                                                                 |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `instructions` attachment                                  | each `attachment.files[].path`                                                                        |
| `nested_memory` attachment                                 | `attachment.path`                                                                                     |
| `file`, `compact_file_reference` attachment                | `attachment.filename` (an `@` mention, and its re-reference after compaction)                         |
| user text beginning `Base directory for this skill: <dir>` | `<dir>/SKILL.md` (a skill invoked by tool or slash command)                                           |
| `invoked_skills` attachment                                | `<dir>/SKILL.md` from the first line of each `skills[].content` (skills re-injected after compaction) |
| assistant `tool_use` named `Read`                          | `input.file_path`                                                                                     |
| assistant `tool_use` named `Agent` or `Task`               | the subagent named `input.subagent_type`                                                              |
| user text holding `<command-name>/<name></command-name>`   | the command named `<name>`                                                                            |

Rows are matched as Claude Code writes them, compact JSON with `attachment.type` first in an
attachment row's `attachment`: a line is parsed only when it is an attachment row of a type above, or
holds `"name":"Read"`, `"name":"Agent"`, `"name":"Task"`, `Base directory for this skill` or
`<command-name>`.

A path matches an entry when its real path is the real path of one of the entry's locations: its
own path, a `walked` path or an `installed` path. A subagent or command name matches by its
listing spelling, as the session states' listings do (Load states, Session). An item inside a file
(a follow-up) takes its file's time. A `hook` or `plugin` entry has no time (`null`): no row loads one,
and a `Read` of its settings file or install folder is not a load of it, as the session context leaves
them out (Session). A path or name no entry holds is dropped; it adds no entry.

**Cache**: `~/.agents/wigley-docs/loads.json`, written by `build` and `context` (temp file, then
rename; the temp file is `loads.json.<pid>.tmp`, so two runs at once never share one). It keeps
`version` (the integer 1), `transcripts` (per transcript, the integer byte offset read up to: the end
of its last complete line), and `paths` and `names` (the latest time of each loaded real path, and of
each loaded subagent and command name). A run reads each transcript from its offset, so only rows
appended since the last run are parsed; a transcript shorter than its offset is read again from the
start. Times only grow, so a re-read and two runs writing the cache at once leave correct times. A
cache that is unreadable, not a JSON object, of another `version`, lacks `transcripts`, `paths` or
`names` as an object, holds an offset that is not a non-negative integer, or holds a time that is not
a string with a UTC offset is rebuilt from every transcript, whole: one bad value drops the entire
cache. `session` reads and writes no cache.

## Local commands

```
(cd agent-plugin/scripts/docs-index && python3 -m unittest discover)
```
