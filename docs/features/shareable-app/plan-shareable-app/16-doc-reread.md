# 16 — Doc re-read against the built code

Status: done
Type: Task
Rung: standard · doc-only: prose checked against settled, landed code
Wave: 9 · Depends on: 01–15 (it reads every landed task's code against the docs), 17 (it runs in the new clone 17 makes, after 17's sweep has fixed the paths)
Plan: [plan.md](plan.md)

## Files

Files (wigley-ai-gui), in `~/Documents/wigley-ai-gui`:
- modify, where a line is stale: `README.md`, `CHANGELOG.md`, `AGENTS.md`, `DESIGN.md`, `docs/keymap.md`,
  `docs/features/feature-contributions/design.md`, every `agent-plugin/skills/*/SKILL.md`,
  `agent-plugin/scripts/relay/README.md`, `agent-plugin/scripts/docs-index/README.md`, `.agents/skills/*/SKILL.md`

Files (ai), in an `ai` worktree:
- modify, where a line is stale: `wigley-ai-marketplace/AGENTS.md`, `wigley-ai-marketplace/README.md`, every
  `wigley-ai-marketplace/plugins/wigley/skills/**/*.md` the plan changed, every `wigley-agents/*.md` and `wigley-agents/tools/*/README.md` the plan changed

Files (personal, edited in place, never committed):
- `~/.agents/AGENTS.local.md` · `~/.claude/hooks/*` comments and deny texts · `~/.codex/AGENTS.md`

## Consumes

- The "Docs written ahead" commit `18112bbb1` (`plan.md` § Docs written ahead).
- Every task's landed code (01–15) and 17's move.

## Decisions

- **The list of docs to read** is the union of:
  1. the files the docs-written-ahead commit touched: `git -C ~/Documents/ai show --name-only --format= 18112bbb1`.
     That commit stays in `ai`'s history; its `wigley-ai-gui/<path>` entries are read at `<path>` in the new clone
     (the split rewrote the app's shas, not its paths);
  2. each doc a task added or changed after that commit: in `ai`,
     `git -C ~/Documents/ai log --name-only --format= 18112bbb1..<split base> -- '*.md' 'wigley-ai-marketplace/plugins/wigley/auri.json'`,
     and in the new clone `git -C ~/Documents/wigley-ai-gui log --name-only --format= -- '*.md'` over the commits since
     the split (17 records `<split base>` in its Proof);
  3. the personal files above, which no commit holds.
  Write the deduplicated list into this doc's Proof section before reading, so the review sees what was covered.
- **Line by line.** Each claim a doc makes about code — a path, a tool or setting name, a default, a key, a hook
  event, a command and its flags, an empty state, a contribution field — is checked against the landed source with a
  grep or a read, batched per doc. A claim that is wrong is fixed in place; a claim the code does not support at all
  and no task built is a gap, reported to the lead rather than written into the doc or the code.
- The line-by-line check is the only check for the nine `agent-plugin/skills/*/SKILL.md` and
  `docs/features/feature-contributions/design.md`: they were written ahead in the built state and carry no planned
  marks (`plan.md` § Docs written ahead), so the mark grep below says nothing about them.
- **Planned marks.** Every mark `wigley:feature` step 1 wrote — the phrase "planned in `shareable-app`, not built yet"
  and any variant ("planned in shareable-app") — is found with
  `command grep -rIn -i 'planned in .\?shareable-app' ~/Documents/wigley-ai-gui ~/Documents/ai ~/.agents ~/.claude/hooks ~/.codex --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=plan-shareable-app`.
  The plan folder is excluded: its own text names the phrase. At plan time (measured, re-verify) the marks were
  `README.md:21` (the Status paragraph), `README.md:86` (the Codex steps) and `AGENTS.md:1216` (§ README, changelog and
  boundary), and task 15 drops the README Status checks and the `AGENTS.md` banner as its scripts land. Each mark is
  dropped when its code has landed, with the sentence reworded to stand without it; the README's Status section goes
  when nothing is left in it, with its Contents line. A mark whose code has not landed stays, and the report names it
  with the task it waits on. Done when the grep prints only those. A hit under `docs/features/` outside the plan
  folder is design text: it is listed, not fixed.
- **Names from File Structure.** Wherever a doc names a shared name — `mcp__plugin_auri_auri__*`, `auri.json`,
  `strategy:<feature>`, `workflow.off`, `workflow.autoStart`, `unity-pool.scriptPath`, `CHECKLIST_WORKFLOW_ID`,
  `WIGLEY_SESSION_ROW` — it matches `plan.md` § File Structure and the code; any old name
  (`mcp__plugin_wigley_wigley-forms__`, `wigley-forms` as the server name, `auto-retro.folder`,
  `workflow-large.autoClearAndMake`, `workflow-large.autoStartSeconds`, `workflow-<level>.layout`) left in a doc is
  stale. Check with
  `command grep -rIn -e 'mcp__plugin_wigley_wigley-forms__' -e 'auto-retro.folder' -e 'autoClearAndMake' -e 'autoStartSeconds' -e 'workflow-small\|workflow-medium\|workflow-large\|workflow-spike' <each doc>`;
  a hit inside `docs/features/` that records history, or the changelog, stays and is listed.
- **What the README covers** is task 15's coverage test's job; this task reads the README's prose for truth, not
  for completeness.
- `wigley:writing-for-agents` governs every edit to a doc an agent reads.
- `learning/` stays untouched (the retro owns it).

## Tests

None added: the README coverage test, changelog lint and boundary lint (task 15) and `check_pointers.py` run in 18.

## Verification

```
command grep -rIn -i 'planned in .\?shareable-app' ~/Documents/wigley-ai-gui ~/Documents/ai ~/.agents ~/.claude/hooks ~/.codex --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=plan-shareable-app
(cd ~/Documents/ai/wigley-ai-marketplace && python3 scripts/check_pointers.py)
(cd ~/Documents/wigley-ai-gui && npm run lint)
```

## Done when

- Every doc on the list was read through its last line, each claim checked, every stale line fixed.
- The planned-mark grep prints only marks whose code has not landed, each in the report with the task it waits on.
- `check_pointers.py` passes.
- The fixes are committed: one landing in the new clone, one in `ai`; personal files edited in place.
- The report lists each doc read, each line fixed, and each gap found.

Commit: one commit per repo for the group.

## Proof

Commit 924dfd766 · proof: Five lanes (reports/16-agents-1, 16-readmes-1, 16-skills-1, 16-ai-1, 16-design-1): app AGENTS.md, READMEs and CHANGELOG, every agent-plugin and .agents skill, keymap, DESIGN.md, and 14 feature designs read and checked against landed src; the ai side's 40-odd skills and agent docs hunk-checked plus a stale-name grep, its six core docs read in full. Lead diff read. npm run lint passes; readme-coverage test passes; the planned-mark grep leaves only README.md:21 (the repo split, task 17). check_pointers.py fails only in wigley-agents/learning/candidates (wigley:visuals, wigley:chatroom names, three § headings), which the retro owns. · concerns: Path references to the app inside ai left for 17's sweep. builds-marked lines (README auri:builds row, keymap km/m, agent-plugin/skills/builds) wait on the Builds run. followups' isStringOrNull copy list may be stale. learning/ candidates name retired wigley:visuals/chatroom skills; the retro owns them. The 1.1.0 release commit was undone and is re-cut after the Builds land.
