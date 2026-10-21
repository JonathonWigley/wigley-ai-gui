# 11 — Final verification

Status: not started
Type: Task
Wave: 8 · Depends on: 10
Plan: [plan.md](plan.md)

The live checks no test or self-test step covers, for the user to run in a visible `npm start` (AGENTS.md § Running
and testing: a visible run takes the user's foreground and keyboard, so it is the user's; the agent gives the steps).
Each check is tagged **expected** (the change doing what it was made to do, on screen) or **low-confidence** (where a
bug is likely), with its reason. Claims the unit tests or task 09's self-test steps already pin are left out.

Files: none (the setup step below edits one line locally and reverts it; nothing is committed).

Consumes: the landed tasks 01–10.

Produces: the user's results, recorded in this document's Proof section by `wigley:make`.

## Setup

1. Check which docs index the app will run: `grep -A3 '"wigley@wigley-ai-marketplace"' ~/.claude/plugins/installed_plugins.json`.
   When its `version` is below the version task 03's run log names (the version task 03 left both manifests on), the
   installed `docs_index.py` predates task 03 (no `claudeConfigDirs`), and a
   session started with `CLAUDE_CONFIG_DIR=~/.claude-personal` has no transcript it can find. The app has no user
   settings file yet (follow-up: the user config file), so for this run only set the default of `scriptPath` in
   `src/plugins/docs/manifest.ts` to
   `'~/Documents/dev/personal/wigley-ai-marketplace/plugins/wigley/scripts/docs-index/docs_index.py'`, and revert it
   after the run with `git -C ~/Documents/dev/wigley-ai-gui checkout -- src/plugins/docs/manifest.ts`. The agent
   names this edit to the user before the run; it is never committed.
2. Add `"claudeConfigDirs": ["~/.claude", "~/.claude-personal"]` to `~/.agents/wigley-docs/config.json` when it is
   not there, in that order: the user runs most sessions under `~/.claude` and only some under `~/.claude-personal`,
   and the first folder is the one Docs mode judges load states against (design.md § Docs browser). That file is the
   user's machine-local config: the agent asks before editing it, or the user edits it.
3. `npm start`.

## Checks

1. **Docs mode on the real index** — low-confidence: the self-test's index has eight entries; the real one has about
   629 entries and 4 MB (design.md, measured 2026-10-19), and nothing tests parse and render time at that size.
   `Space k d`. The tree shows at once from the last `index.json` with `Global`, `Plugins`, then one node per repo;
   the status line reads `Rebuilding the docs index…` and clears when the build ends (about 13 s); scrolling and
   `j`/`k` stay smooth; `Space k d` again hides the tree, again shows it.
2. **Rendered docs** — expected: open wigley-ai-gui's `AGENTS.md` (the self-test's docs hold no code blocks or wide tables).
   Headings, lists and the layout tree's code block render; fenced code is highlighted in the theme's `syntax.*`
   colours; a wide table scrolls in its own box. Open a skill's `SKILL.md`: its frontmatter shows as a two-column
   table above the body. Open a `settings.json` hook's file through its detail view's `i`: JSON is highlighted.
3. **Link kinds** — low-confidence: the self-test follows one relative link; `http(s)` goes through
   `shell.openExternal`, which the self-test stubs, and the heading ids come from task 02's slug rule against links
   written by people. In a doc with a `#heading` link, follow it: the pane scrolls to that heading. Follow an `https`
   link: the default browser opens it and the app keeps its state. Follow a link to a file outside every indexed
   folder: the toast `Not an indexed doc: <path>`.
4. **Load-state chips and `c`** — expected: a doc under a repo shows `Claude <state>` and `Codex <state>`; hovering a
   chip shows the reason. `c`, pick that repo's folder: the chips change to that folder's states (an `AGENTS.md`
   `shadowed` by a `CLAUDE.md` is a good case).
5. **`i` at the line shown** — low-confidence: the top-visible-line mapping uses rendered block offsets, which only a
   real layout gives. Scroll a long doc halfway, press `i`: the editor opens with the line that was at the top of the
   rendered view at or near its top. Markdown, JSON, TOML and YAML files are highlighted in the editor.
6. **Changes made outside the app** — low-confidence: watching is tested on a temp folder, but editors replace files
   (write a temp file and rename), which a watch on the old file can miss. With a doc open rendered, change it in
   another editor and save: the view reloads. Press `i`, change the file again outside: the banner
   `Changed on disk since you opened it` shows; `:w` asks `File changed on disk — r reload, o overwrite, Esc cancel`;
   `r` loads the disk text; repeat and `o` writes the editor's text.
7. **Plugin cache, hooks, plugins** — expected: a skill under `Plugins` shows `Plugin cache — <plugin>. Edit the
   source repo's copy.` and `i` toasts that line. A hook shows Event, Matcher and Command; a plugin shows Harness,
   Version, Enabled and Installs. A hook's `i` opens its settings file at the hook's line; a plugin's `i` opens the
   `installed_plugins.json` that lists it (a Codex plugin: `~/.codex/config.toml`) at the plugin's key, editable.
8. **Create, rename and delete on the real index** — low-confidence: the self-test's stand-in build lists new rules
   only; the real build decides kind and load states. In a scratch repo under `~/Documents/dev`: `a`, `skill`, the
   repo's skills place, name `scratch-skill`: the editor opens on `description:`; `:wq`. The leaf shows at once with
   `pending` chips, which become real states when the build lands. `r` the `SKILL.md` to another skill folder name
   (path box, Tab completes folder names): the folder moves. `d`, `y`: the skill's folder is in the macOS Trash
   (Finder) — the self-test's trash deletes for good (task 01), so only this run proves `shell.trashItem`.
9. **Path box typing** — low-confidence: the box keeps typed keys from the page keys by stopping their propagation,
   which only real key events prove. `A`, type a path holding a space (`~/Library/Application Support/`): the space
   types, no which-key panel opens; `Tab` completes; `Esc` cancels.
10. **A live session's Docs tab** — expected: start a Claude Code session in a repo (with `CLAUDE_CONFIG_DIR=~/.claude-personal`
    too, when Setup step 2 added it). Its sidebar row's Docs tab lists the docs that session's index finds, with the
    session's own states; `c` toasts `A session's Docs tab uses the session's own load states`. End the session: the
    Docs tab goes with its row.
11. **Hidden mode keeps edits** — expected: in Docs mode, `i` on a doc, type without saving, Esc to normal mode, `Space k s`, then
    `Space k d`: the editor still holds the unsaved text.

## GIVEN / WHEN / THEN

- GIVEN the real docs index WHEN the user runs the checks above THEN each behaves as written, or the user reports what differed.

## Tests

None: live checks.

## Done when

The user has run every check and reported each result; failures become findings for the lead. The Setup step 1 edit
is reverted (`git -C ~/Documents/dev/wigley-ai-gui status --porcelain -- src` → empty).

## Commit

None.

## Proof

