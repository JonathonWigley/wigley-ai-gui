# 06 — Docs main part

Status: not started
Type: Task
Wave: 2 · Depends on: 01, 04
Plan: [plan.md](plan.md)

The `docs` plugin's manifest, its channel contract, and its main part: the two index sources (machine and session),
the script locator, the guarded file changes, file watching, external links, and the self-test fixture. The page part
is task 07; this task's manifest declares no page command or key yet, so the page starts clean with no docs page part.

Files:
- create `src/plugins/docs/manifest.ts`; modify `src/plugins/docs/contract.ts` (04 created it with the index types;
  this task adds the channel)
- create `src/plugins/docs/main/start.ts`, `src/plugins/docs/main/index-sources.ts`,
  `src/plugins/docs/main/script-locator.ts`, `src/plugins/docs/main/doc-files.ts`,
  `src/plugins/docs/main/selftest-fixture.ts`
- test `src/plugins/docs/main/index-sources.test.ts`, `src/plugins/docs/main/script-locator.test.ts`,
  `src/plugins/docs/main/doc-files.test.ts`
- modify `src/plugins/manifests.ts` (add `docsManifest` after `keysManifest`), `src/plugins/main.ts` (add
  `docsMainPart` after `formsMainPart`)
- modify `src/contracts/plugin.ts` (`MainServices.openExternal`), `src/main/main.ts` (fill it)

Consumes:
- `Files`, `FileStat`, `FolderEntry`, `FileWatch` (`src/contracts/files.ts`), `ProcessRunner`, `ProcessResult`
  (`src/contracts/processes.ts`), `MainServices.files`, `MainServices.processes` ← 01
- the test doubles in `src/shared/testing/memory-files.ts` and `src/shared/testing/fake-processes.ts` ← 01, under the
  names 01 exports (tests only)
- the `LAYERS` entries for `src/plugins/docs/contract.ts` (`src/contracts` only), `src/plugins/docs`,
  `src/plugins/docs/main`, and the composition roots' lists naming them ← 01
- from 04: `IndexDocument`, `IndexEntry`, `IndexHarness`, `CreateKind`, `CreatePlace` (contract.ts);
  `parseIndexDocument` (index-document.ts);
  `changeRefusal` (path-guard.ts); `createTarget`, `nameProblem`, `skillFolder` (kinds.ts);
  `expandTilde`, `joinPath`, `normalizePath`, `parentFolder`, `baseName`, `isInside` (doc-paths.ts)
- `definePlugin` (`src/shared/define-plugin.ts`), `errorText` (`src/shared/error-text.ts`) — in the tree

## Produces

```ts
// src/contracts/plugin.ts — MainServices gains:
  // Opens an http(s) or mailto URL in the user's default app.
  openExternal(url: string): Promise<void>;

// src/plugins/docs/manifest.ts — task 07 adds the page commands, scopes, keys and dependsOn.
export const docsManifest = definePlugin({
  id: 'docs', dependsOn: [], commands: {}, scopes: {},
  keys: { page: [], editor: [], app: [], global: [], intercept: [] },
  settings: { scriptPath: '' },
});

// src/plugins/docs/contract.ts (added to 04's types; imports only `src/contracts`, so `FolderEntry` comes from
// `src/contracts/files.ts` and the harness is 04's `IndexHarness`, the same union as sessions' `Harness`)
// What one run of an index source gives the view: the document to show (null: none) and a line to show above
// the tree (null: none).
export interface IndexLoad { document: IndexDocument | null; message: string | null; }
// A session's Docs tab's source, from sessions' `sessionAdded` payload.
export interface SessionSourceSpec { hostSessionId: string | null; projectDir: string | null; harness: IndexHarness | null; }
export type WriteResult = { type: 'written' } | { type: 'changedOnDisk'; diskText: string };
export type CreateRequest =
  | { type: 'kind'; kind: CreateKind; place: CreatePlace; name: string }
  | { type: 'path'; path: string };
// `line` is 1-based: where the editor opens on the new file.
export interface CreatedDoc { path: string; line: number; }
export interface DocChange { viewId: string; path: string; }
// Every method rejects with main's own error text when its handler throws; each throw below is that text.
export interface DocsChannel extends ChannelShape {
  invoke: {
    homeDir(): Promise<string>;
    machineIndex(): Promise<IndexLoad>;
    rebuild(): Promise<IndexLoad>;
    sessionIndex(spec: SessionSourceSpec): Promise<IndexLoad>;
    readDoc(path: string): Promise<string>;
    // `expectedText` null overwrites whatever is on disk.
    writeDoc(path: string, text: string, expectedText: string | null): Promise<WriteResult>;
    createDoc(request: CreateRequest): Promise<CreatedDoc>;
    renameDoc(from: string, to: string): Promise<string>;   // the path the doc now has
    trashDoc(path: string): Promise<string>;                // the path moved to the Trash
    listFolder(folder: string): Promise<FolderEntry[]>;
    // One watched file per view; `path` null stops that view's watch.
    watchDoc(viewId: string, path: string | null): Promise<void>;
    unwatchAll(): Promise<void>;
    openExternal(url: string): Promise<void>;
    // The config file that lists plugin `key` (`<plugin>@<marketplace>`) and the 1-based line holding it; null when
    // none lists it.
    pluginConfigFile(key: string, harness: IndexHarness): Promise<{ path: string; line: number } | null>;
  };
  messages: { docChanged: DocChange };
}

// src/plugins/docs/main/script-locator.ts
export const WIGLEY_PLUGIN_KEY = 'wigley@wigley-ai-marketplace';
export const DEFAULT_CLAUDE_CONFIG_DIRS: readonly string[] = ['~/.claude'];
// Each configured Claude config folder, `~` expanded, in config order.
export function readClaudeConfigDirs(files: Files, homeDir: string): Promise<string[]>;
// The docs_index.py to run, or null when none is found.
export function locateScript(files: Files, homeDir: string, scriptPath: string): Promise<string | null>;

// src/plugins/docs/main/index-sources.ts
export interface IndexSourcesDeps {
  files: Files; processes: ProcessRunner; homeDir: string; scriptPath: string; log: Log;
}
export interface IndexSources {
  machineIndex(): Promise<IndexLoad>;
  rebuild(): Promise<IndexLoad>;
  sessionIndex(spec: SessionSourceSpec): Promise<IndexLoad>;
  // The entries of the machine document last read; [] before any read or after a failed one.
  machineEntries(): readonly IndexEntry[];
}
export function createIndexSources(deps: IndexSourcesDeps): IndexSources;

// src/plugins/docs/main/doc-files.ts
export interface DocFilesDeps {
  files: Files; homeDir: string;
  entries(): readonly IndexEntry[];          // the machine index's, for the guard
}
export interface DocFiles {
  read(path: string): Promise<string>;
  write(path: string, text: string, expectedText: string | null): Promise<WriteResult>;
  create(request: CreateRequest): Promise<CreatedDoc>;
  rename(from: string, to: string): Promise<string>;
  trash(path: string): Promise<string>;
  list(folder: string): Promise<FolderEntry[]>;
  pluginConfigFile(key: string, harness: IndexHarness): Promise<{ path: string; line: number } | null>;
}
export function createDocFiles(deps: DocFilesDeps): DocFiles;

// src/plugins/docs/main/selftest-fixture.ts
// Writes the self-test's docs, index and stand-in docs_index.py under `homeDir` (the self-test's temp home).
export function writeDocsFixture(files: Files, homeDir: string): Promise<void>;

// src/plugins/docs/main/start.ts
export const docsMainPart: MainPart<typeof docsManifest>;
```

## Decisions

**Manifest** — `settings.scriptPath` `''` (design.md § Docs browser: a `docs.scriptPath` setting, empty by default).
Task 07 adds the page commands, scopes, keys and `dependsOn: ['sessions', 'keys']`; until then the manifest holds
none, so the page's `requireRegistered` check finds no unregistered docs command.

**`MainServices.openExternal`** (plan.md Decisions: `shell.openExternal` stays in main; plugins import no
`electron`, AGENTS.md **A plugin talks**). A new ambient service beside `files` and `processes`, named in the
drafter's report. `main.ts` fills it with `(url) => shell.openExternal(url)` (Electron 44 `shell.openExternal(url):
Promise<void>`, verified against electronjs.org/docs/latest/api/shell), and in the self-test with a function that
logs `external link not opened in the self-test: <url>` under source `main` and resolves, so the self-test never
takes the user's foreground.

**Machine source** (plan.md Decisions, first bullet).
- Index file: `<homeDir>/.agents/wigley-docs/index.json`. `machineIndex()` reads it now: missing (stat null) →
  `{ document: null, message: 'No docs index yet — building…' }`; unparsable → `{ document: null, message: <the
  parse message> }` (04's messages); else `{ document, message: null }`. `machineEntries()` follows the last read.
- `rebuild()` runs `python3 <script> build`, then reads the file as `machineIndex()` does. A `rebuild()` called while
  a build runs queues one more build after it (at most one queued); every caller that arrived during the running
  build gets the queued build's result, so a change made after a build started is in the result its caller waits
  for (the `pending` chips rule, task 08).
- Exit code other than 0 → the read's document, with `message` the first non-empty line of stderr, or
  `docs_index.py exited <code>` when stderr is empty; the whole stderr is logged (below).
- No script → the read's document, `message` `docs_index.py not found — set docs.scriptPath` (pinned in plan.md).
- `processes.run` rejecting (python3 cannot start) → the read's document, `message` the rejection's text (01's
  adapter: `Could not run python3: <error message>`).

**Session source** (plan.md Decisions; design.md § Docs browser). The rule, first match:
- `hostSessionId` non-null and `harness` not `codex` → `python3 <script> session <hostSessionId>`
- `projectDir` non-null → `python3 <script> context <projectDir>`
- else `{ document: null, message: 'No project folder is known for this session' }`
Exit 0 → stdout parsed with `parseIndexDocument` (a parse failure gives `document: null` and its message); other
exits, no script and a rejected run give `document: null` and the message the machine source gives for the same
case. A session document has one context; the view uses it (task 07). The session source keeps no state.
(plan.md says "for a Claude session"; a relay older than plan A sends no harness, so harness `null` with a host id
runs `session` too — Codex sets no `CLAUDE_CODE_SESSION_ID`, design.md § Modes and layout.)

**Logs** (source `docs`, through `services.log`): a non-zero exit logs `docs_index.py <command> exited <code>:
<stderr, trimmed>`; exit 0 with non-empty stderr logs `docs_index.py <command> wrote to stderr: <stderr, trimmed>`;
`<command>` is `build`, `session` or `context`.

**Script locator** (plan.md Decisions, second bullet).
- `scriptPath` non-empty → `expandTilde(scriptPath)`, returned without a check (a wrong path fails in the run, with
  python's stderr as the message).
- Else for each folder of `readClaudeConfigDirs`, in order: read `<dir>/plugins/installed_plugins.json`; take
  `plugins["wigley@wigley-ai-marketplace"]` (an array of install records); for each record with a string
  `installPath`, the candidate is `<installPath>/scripts/docs-index/docs_index.py`; the first candidate whose
  `files.stat` is a file (not a folder) is the script. A missing or unparsable file, or a value of the wrong shape,
  is skipped. None found → null.
- `readClaudeConfigDirs`: `<homeDir>/.agents/wigley-docs/config.json`'s `claudeConfigDirs` when it is a non-empty
  array of strings, else `DEFAULT_CLAUDE_CONFIG_DIRS`; a missing or unparsable file takes the default. Each item is
  `expandTilde`d. (README § Config: a list that is not a list of strings, or is empty, takes the default.) The app
  never writes `config.json`.

**Guarded file changes** (plan.md Decisions: main refuses every write, create, rename and trash outside the guard).
- The guard's real target: for an existing path, `files.realPath(path)`; for a new path, the `realPath` of its
  nearest existing ancestor joined with the remaining segments. The guard's config folders are
  `readClaudeConfigDirs`, each `realPath`ed when it exists, read on each change. `changeRefusal(realTarget,
  deps.entries(), configDirs)` non-null → throw `Error(<that refusal>)`.
- Every path the page sends is `expandTilde`d and `normalizePath`d first; a result that does not start with `/`
  throws `A path starts with / or ~`.
- `write(path, text, expectedText)`: guard; when `expectedText` is non-null, read the file (missing reads as `''`)
  and when it differs from `expectedText` return `{ type: 'changedOnDisk', diskText }` without writing; else
  `files.write` (atomic, 01) and `{ type: 'written' }`.
- `create({ type: 'kind', … })`: `nameProblem(kind, name)` non-null → throw it; `createTarget(kind, place,
  name.trim())`; guard its path; an existing file throws `<path> already exists` unless the target `appends`;
  `files.makeFolder(parentFolder(path))`; write `contents(existing).text`; return `{ path, line:
  contents(existing).line }`. `place` arrives from the page and is not trusted: the guard on the target is the check.
- `create({ type: 'path', path })`: a path ending in `/` throws `A path names a file, not a folder`; an existing path
  throws `<path> already exists`; guard; `makeFolder(parent)`; write `''`; return `{ path, line: 1 }`.
- What counts as a skill: `skillFolder(path)` (04) non-null — a `SKILL.md` under a `skills/` folder, whatever the
  index lists (a skill made a moment ago, or one only a session index lists, moves and trashes as a folder too; the
  page's provisional entry uses the same function, 08).
- `rename(from, to)`: `to` equal to `from` returns `from` and does nothing. When `skillFolder(from)` is non-null:
  `baseName(to)` other than `SKILL.md` throws `A skill's SKILL.md keeps its name; rename its folder`;
  otherwise the skill's folder `parentFolder(from)` moves to `parentFolder(to)` and the result is `to`. Else the file
  moves. Either way: the moved item's real path and the destination's real target are both guarded; an existing
  destination throws `<destination> already exists`; `makeFolder(parentFolder(destination))`; `files.rename`.
- `trash(path)`: a path whose `skillFolder` is non-null trashes that folder (plan.md Decisions, Delete); guard the trashed
  item; `files.trash`; return the trashed path.
- `read(path)`: no guard (plan.md guards changes only); a missing file rejects with the `Files.read` error.
- `list(folder)`: a missing path or a file → `[]`; else `files.list(folder)`.
- `pluginConfigFile(key, harness)` (a plugin entry's `path` is its install folder, not a file; README § The index
  file): `claude` → for each folder of `readClaudeConfigDirs` in order, `<dir>/plugins/installed_plugins.json` when
  its text holds `"<key>"`; `codex` → `<homeDir>/.codex/config.toml` when its text holds `<key>`. The result's `line`
  is the first 1-based line holding that text; none found → null. Read only; the edit goes through `write` and its
  guard (a Claude config folder is inside it).

**Home folder** — `homeDir()` returns `files.realPath(services.homeDir)`, read once at start, and the main part uses
that real path for the index file, `config.json` and every `~` it expands: the index holds real paths, and under the
self-test the temp home is a link into `/private` (`/var/folders/…`), so `~` titles and the guard need the real form.
On a normal Mac the home folder is already real.

**Watching** (design.md § Docs browser, Disk changes). `start.ts` keeps one `FileWatch` per `viewId`:
`watchDoc(viewId, path)` closes that view's watch, then, with `path` non-null, `files.watch(path, () =>
channel.send('docChanged', { viewId, path }))`. `unwatchAll()` closes every watch: the page calls it at its start,
since a page reload leaves main's watches behind. `dispose` closes every watch.

**External links** — `openExternal(url)` with a scheme other than `http:`, `https:` or `mailto:`
(case-insensitive) throws `Only http, https and mailto links open outside the app`; else
`services.openExternal(url)`.

**Self-test fixture** (AGENTS.md § Running and testing: the self-test runs under a temp home, `homeFolder()` in
`src/main/main.ts`; docs never reads or writes the user's real docs or index during it).
- `start` calls `writeDocsFixture(files, homeDir)` when `services.selfTest` is non-null, before serving anything:
  it keeps the returned promise, and every channel handler awaits it first. The docs plugin hands the driver no
  script (only forms' runs; task 09 adds the docs steps to it).
- Under the self-test, `homeDir` is the temp home, so the index path, `config.json`, the Claude config folder
  `~/.claude` and the plugin's `installed_plugins.json` all resolve inside it; `scriptPath` is `''` (main parts
  start on their defaults), so the locator finds the stand-in script the fixture installs, never the user's.
- The stand-in script never reads `HOME`: its temp home is written into it as a literal. Real python3 runs it
  (python3 ships with macOS; it is no third-party package).
- `H` below is `files.realPath(homeDir)` (the macOS temp folder is a link into `/private`), so the index's paths are
  the real paths the guard compares. Files the fixture writes, each text verbatim:
  - `H/.claude/CLAUDE.md`:
    `# Self-test instructions\n\nSee [the style rule](rules/style.md) and [the web](https://example.com).\n\n## Second heading\n\nBack [to the top](#self-test-instructions).\n`
  - `H/.claude/rules/style.md`: `# Style\n\nWrite short lines.\n`
  - `H/.claude/settings.json`: `{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"lint"}]}]}}\n`
  - `H/dev/selftest-repo/AGENTS.md`: `# Repo instructions\n`
  - `H/dev/selftest-repo/.claude/skills/demo/SKILL.md`: `---\nname: demo\ndescription: A self-test skill.\n---\n\n# Demo\n`
  - `H/.claude/plugins/cache/selftest-market/selftest-plugin/1.0.0/skills/cached/SKILL.md`:
    `---\nname: cached\ndescription: A plugin skill.\n---\n\n# Cached\n`
  - `H/wigley-features/selftest-repo/followups.md`: `# Follow-ups\n\n- **First follow-up** — waits.\n`
  - `H/.claude/plugins/installed_plugins.json`:
    `{"version":2,"plugins":{\n"wigley@wigley-ai-marketplace":[{"scope":"user","installPath":"H/.claude/plugins/cache/wigley-ai-marketplace/wigley/0.0.0"}],\n"selftest-plugin@selftest-market":[{"scope":"user","installPath":"H/.claude/plugins/cache/selftest-market/selftest-plugin/1.0.0"}]\n}}\n`
    (`H` substituted; `\n` a line break, so the plugin's key sits on line 3)
  - `S` = `H/.claude/plugins/cache/wigley-ai-marketplace/wigley/0.0.0/scripts/docs-index`: `S/index.fixture.json`
    (the index document below), `S/session.fixture.json` (the session document below), and `S/docs_index.py`:
    ```python
    import json, os, sys
    HOME = <JSON string of H>
    HERE = os.path.dirname(os.path.abspath(__file__))
    def text(name):
        with open(os.path.join(HERE, name), encoding="utf-8") as file:
            return file.read()
    def built_index():
        doc = json.loads(text("index.fixture.json"))
        doc["entries"] = [entry for entry in doc["entries"] if os.path.exists(entry["path"])]
        known = {entry["path"] for entry in doc["entries"]}
        rules = os.path.join(HOME, ".claude", "rules")
        for name in sorted(os.listdir(rules)):
            path = os.path.join(rules, name)
            if name.endswith(".md") and path not in known:
                doc["entries"].append({"id": path, "kind": "rule", "source": "global", "repo": None,
                    "root": None, "plugin": None, "path": path, "line": None, "title": name,
                    "meta": {"paths": []}})
        doc["entries"].sort(key=lambda entry: entry["id"])
        return json.dumps(doc, indent=2)
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "build":
        target = os.path.join(HOME, ".agents", "wigley-docs", "index.json")
        with open(target + ".tmp", "w", encoding="utf-8") as file:
            file.write(built_index())
        os.replace(target + ".tmp", target)
    elif command in ("session", "context"):
        print(text("session.fixture.json"))
    else:
        print("self-test docs_index.py: unknown command " + command, file=sys.stderr)
        sys.exit(2)
    ```
    Its `build` stands in for the real one only as far as the self-test's changes need: it drops entries whose file
    is gone and lists each new `.md` in `H/.claude/rules` as a global rule titled by its file name, so a create,
    rename or trash in that folder survives the background build (task 09's steps change files only there).
  - `H/.agents/wigley-docs/index.json`: the index document below.
- The index document (`schemaVersion` 1, `generatedAt` `2026-10-19T00:00:00Z`), eight entries, each `id` = `path`
  unless given; `meta` `{}` unless given:

  | kind | source | repo | root | plugin | path | line | title | meta |
  |---|---|---|---|---|---|---|---|---|
  | instructions | global | null | null | null | `H/.claude/CLAUDE.md` | null | `Self-test instructions` | `{ imports: [] }` |
  | rule | global | null | null | null | `H/.claude/rules/style.md` | null | `Style` | `{ paths: [] }` |
  | hook | global | null | null | null | `H/.claude/settings.json` (id `H/.claude/settings.json#hook:PreToolUse:0`) | null | `PreToolUse Bash → lint` | `{ event: 'PreToolUse', matcher: 'Bash', command: 'lint' }` |
  | plugin | plugin | null | `H/.claude/plugins/cache/selftest-market/selftest-plugin/1.0.0` | `selftest-plugin@selftest-market` | `H/.claude/plugins/cache/selftest-market/selftest-plugin/1.0.0` (the install folder, as the real index gives it) | null | `selftest-plugin@selftest-market` | `{ harness: 'claude', version: '1.0.0', installs: [{ scope: 'user', projectPath: null }] }` |
  | instructions | repo | `selftest-repo` | `H/dev/selftest-repo` | null | `H/dev/selftest-repo/AGENTS.md` | null | `Repo instructions` | `{ imports: [] }` |
  | skill | repo | `selftest-repo` | `H/dev/selftest-repo` | null | `H/dev/selftest-repo/.claude/skills/demo/SKILL.md` | null | `demo` | `{ name: 'demo', description: 'A self-test skill.' }` |
  | skill | plugin | null | `H/.claude/plugins/cache/selftest-market/selftest-plugin/1.0.0` | `selftest-plugin@selftest-market` | `…/1.0.0/skills/cached/SKILL.md` | null | `cached` | `{ name: 'cached', description: 'A plugin skill.' }` |
  | followup | features | `selftest-repo` | `H/wigley-features/selftest-repo` | null | `H/wigley-features/selftest-repo/followups.md` (id `…/followups.md#L3`) | 3 | `First follow-up` | `{ status: 'open', gist: 'waits.', section: null }` |

  Contexts: folder `H`, `sessionId` null, states: `CLAUDE.md` → claude `launch` / `user CLAUDE.md`, codex
  `not-loaded` / `Claude Code file`; `style.md` → claude `launch` / `rule without paths`. Folder
  `H/dev/selftest-repo`, `sessionId` null, states: `AGENTS.md` → claude `launch` / `AGENTS.md in the folder`, codex
  `launch` / `AGENTS.md in the folder`.
- The session document: the same header; entries the first, second, fifth and sixth rows above (four entries); one
  context, folder `H/dev/selftest-repo`, `sessionId` `selftest-session`, states: `CLAUDE.md` → claude `launch` /
  `in the transcript`; `AGENTS.md` → claude `launch` / `in the transcript`.
- The fixture writes the index file last, so a reader never sees an index whose files are missing. It runs once per
  main start; a page reload keeps what earlier steps wrote.

## GIVEN / WHEN / THEN

- GIVEN no `index.json` WHEN the page asks for the machine index THEN `{ document: null, message: 'No docs index yet — building…' }`.
- GIVEN a build that exits 1 with stderr `boom\nmore` WHEN rebuild runs THEN the message is `boom`, the read document stays, and the log holds `docs_index.py build exited 1: boom\nmore`.
- GIVEN a build is running WHEN two rebuilds are asked THEN exactly one more build runs after it and both callers get its result.
- GIVEN a Codex session with no folder WHEN its source runs THEN `No project folder is known for this session`.
- GIVEN `docs.scriptPath` empty and the wigley plugin installed in the second config folder only WHEN the script is located THEN that install's `docs_index.py`.
- GIVEN a write whose file changed on disk WHEN the page writes with the loaded text as expected THEN nothing is written and `changedOnDisk` carries the disk text.
- GIVEN a target inside a plugin install folder WHEN any change is asked THEN it rejects with the guard's refusal.
- GIVEN a skill's `SKILL.md` WHEN it is trashed THEN its folder goes to the Trash.

## Tests

Each test builds its own `MemoryFiles` and `FakeProcesses` (01's doubles, `src/shared/testing/`) with home
`/Users/u`; `MemoryFiles.realPath` returns the path when something is there, so the guard's link handling is not
reachable in these tests (task 11 check 8 covers a real repo).

`script-locator.test.ts`
- `locateScript_SettingSet_ReturnsItExpanded` — `scriptPath` `~/src/docs_index.py` → `/Users/u/src/docs_index.py`.
- `locateScript_InstalledInDefaultDir_ReturnsInstallScript` — `/Users/u/.claude/plugins/installed_plugins.json` `{"plugins":{"wigley@wigley-ai-marketplace":[{"installPath":"/Users/u/.claude/plugins/cache/w/wigley/9.9.9"}]}}` and the file `/Users/u/.claude/plugins/cache/w/wigley/9.9.9/scripts/docs-index/docs_index.py` → that path.
- `locateScript_SecondConfigDir_Found` — `config.json` `{"claudeConfigDirs":["~/.claude","~/.claude-personal"]}`; only `/Users/u/.claude-personal/plugins/installed_plugins.json` holds an install whose script exists → the `.claude-personal` install's script.
- `locateScript_InstallPathWithoutScript_SkipsIt` — two records, the first's script missing → the second's.
- `locateScript_NothingInstalled_Null` — no files → null.
- `readClaudeConfigDirs_EmptyOrWrongShape_Default` — `{"claudeConfigDirs":[]}`, `{"claudeConfigDirs":"~/.x"}`, `{"claudeConfigDirs":[1]}`, `not json` → each `['/Users/u/.claude']`.

`index-sources.test.ts` (script `/s/docs_index.py` set through `scriptPath`)
- `machineIndex_NoFile_BuildingMessage` — `{ document: null, message: 'No docs index yet — building…' }`.
- `machineIndex_SchemaTwo_PinnedMessage` — file `{"schemaVersion":2}` → message `Unsupported docs index schema 2; this app reads 1`, `machineEntries()` `[]`.
- `rebuild_ExitZero_ReadsTheNewFile` — the fake run for `python3 ['/s/docs_index.py','build']` writes a one-entry index into the memory files and exits 0 → document with one entry, message null; `machineEntries()` has that entry.
- `rebuild_ExitNonZero_FirstStderrLineAndLog` — exit 1, stderr `\nboom\nmore\n` → message `boom`; the log recorded `['docs', 'docs_index.py build exited 1: boom\nmore']`.
- `rebuild_ExitNonZeroNoStderr_ExitCodeMessage` — exit 3, stderr `` → `docs_index.py exited 3`.
- `rebuild_RunRejects_RejectionText` — the run rejects with `Error('Could not run python3: spawn python3 ENOENT')` → message `Could not run python3: spawn python3 ENOENT`.
- `rebuild_NoScript_NotFoundMessage` — `scriptPath` `''`, nothing installed → `docs_index.py not found — set docs.scriptPath`; no run recorded.
- `rebuild_CalledTwiceWhileRunning_OneMoreBuild` — the first build's run is held unresolved; call `rebuild()` three times; release the runs in order → exactly two runs recorded; the second and third calls resolve to the same `IndexLoad` object.
- `sessionIndex_ClaudeSession_RunsSession` — `{ hostSessionId: 'abc', projectDir: '/p', harness: 'claude' }` → run args `['/s/docs_index.py', 'session', 'abc']`; stdout a valid document → that document.
- `sessionIndex_NullHarnessWithHostId_RunsSession` — `harness: null`, `hostSessionId: 'abc'` → `session abc`.
- `sessionIndex_CodexWithFolder_RunsContext` — `{ hostSessionId: null, projectDir: '/p', harness: 'codex' }` → `['/s/docs_index.py', 'context', '/p']`.
- `sessionIndex_NoFolder_Message` — `{ hostSessionId: null, projectDir: null, harness: 'codex' }` → `{ document: null, message: 'No project folder is known for this session' }`, no run.
- `sessionIndex_ExitZeroWithStderr_Logged` — stderr `warn` on exit 0 → log `['docs', 'docs_index.py session wrote to stderr: warn']`.

`doc-files.test.ts` (entries: repo `r` root `/Users/u/dev/r`; a repo skill at `/Users/u/dev/r/.claude/skills/s/SKILL.md`; plugin `p@m` root `/Users/u/.claude/plugins/cache/m/p/1`)
- `write_ExpectedMatches_Writes` — disk `a`, `write(path, 'b', 'a')` → `{ type: 'written' }`, disk `b`.
- `write_ExpectedDiffers_ReturnsDiskText` — disk `c`, `write(path, 'b', 'a')` → `{ type: 'changedOnDisk', diskText: 'c' }`, disk still `c`.
- `write_NullExpected_Overwrites` — disk `c`, `write(path, 'b', null)` → written, disk `b`.
- `write_InsidePluginCache_RejectsWithRefusal` — `/Users/u/.claude/plugins/cache/m/p/1/x.md` → rejects `Refused: /Users/u/.claude/plugins/cache/m/p/1/x.md is inside the plugin cache of p@m`.
- `write_Outside_RejectsNamingPath` — `/Users/u/Desktop/x.md` (folder made with `makeFolder`) → rejects `Refused: /Users/u/Desktop/x.md is outside the indexed folders`.
- `create_KindSkill_WritesTemplateAndFolder` — `{ type: 'kind', kind: 'skill', place: { title: 'r · ~/dev/r/.claude/skills', folder: '/Users/u/dev/r/.claude/skills', source: 'repo' }, name: ' tidy ' }` → `{ path: '/Users/u/dev/r/.claude/skills/tidy/SKILL.md', line: 3 }`, the file holds `---\nname: tidy\ndescription: \n---\n\n# tidy\n\n`.
- `create_KindBadName_RejectsWithProblem` — name `My Skill` → rejects `A skill name is lowercase letters, digits and hyphens`.
- `create_Existing_RejectsAlreadyExists` — a rule target that exists → rejects `/Users/u/dev/r/.claude/rules/a.md already exists`.
- `create_Followup_AppendsToExistingFile` — `/Users/u/dev/r/docs/features/followups.md` holds `# F\n` (inside root `/Users/u/dev/r`) → `{ line: 2 }`, file `# F\n- **new** — \n`.
- `create_PathEndingInSlash_Rejects` — `~/dev/r/x/` → `A path names a file, not a folder`.
- `create_RelativePath_Rejects` — `dev/x.md` → `A path starts with / or ~`.
- `create_Path_EmptyFileWithParents` — `~/dev/r/new/deep/x.md` → `{ path: '/Users/u/dev/r/new/deep/x.md', line: 1 }`, the file holds `''`.
- `rename_File_Moves` — `/Users/u/dev/r/a.md` → `/Users/u/dev/r/sub/b.md`; result the new path; old path gone.
- `rename_SkillToOtherFolder_MovesFolder` — from the skill's `SKILL.md` to `/Users/u/dev/r/.claude/skills/t/SKILL.md` → folder `…/skills/s` now at `…/skills/t`, a second file `…/skills/s/ref.md` moved with it.
- `rename_SkillToOtherName_Rejects` — to `…/skills/s/README.md` → `A skill's SKILL.md keeps its name; rename its folder`.
- `rename_DestinationExists_Rejects` — `<destination> already exists`.
- `pluginConfigFile_ClaudeSecondDir_KeyLine` — `config.json` `{"claudeConfigDirs":["~/.claude","~/.claude-personal"]}`; `/Users/u/.claude/plugins/installed_plugins.json` `{"plugins":{}}`; `/Users/u/.claude-personal/plugins/installed_plugins.json` `{\n"plugins":{\n"p@m":[]\n}}` → `{ path: '/Users/u/.claude-personal/plugins/installed_plugins.json', line: 3 }`; key `q@m` → null.
- `pluginConfigFile_Codex_ConfigToml` — `/Users/u/.codex/config.toml` `[features]\n\n[plugins."p@m"]\nenabled = true\n` → `{ path: '/Users/u/.codex/config.toml', line: 3 }`.
- `rename_UnlistedSkill_MovesFolder` — no entry lists `/Users/u/dev/r/.claude/skills/new/SKILL.md` (inside root `/Users/u/dev/r`); renamed to `…/skills/newer/SKILL.md` → the folder `…/skills/new` moved.
- `trash_SkillMd_TrashesFolder` — result `/Users/u/dev/r/.claude/skills/s`; `files.trashed` is `['/Users/u/dev/r/.claude/skills/s']`.
- `list_MissingFolder_Empty` — `[]`.

The start wiring (channel handlers, the fixture gate, watches) is proved by the self-test steps of task 09.

## Done when

`npm run typecheck`, `npm run lint` pass; the test gate runs the tests above; `npm run selftest` still passes (the
docs main part starts, writes its fixture into the temp home and serves nothing yet).

## Commit

One commit for the group: "Docs plugin main part: index sources, script locator, guarded doc files, watching, self-test fixture".

## Proof

