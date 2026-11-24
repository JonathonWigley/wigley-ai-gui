# 17 — Move the app to JonathonWigley/wigley-ai-gui

Status: done
Type: Task
Rung: hard · history rewrite, a force push and a sweep across two repos and the user's personal files, with an edit to `wigley-repo-files` that no existing pattern settles
Wave: 8 · Depends on: 01–15 (the split takes the app folder as `ai`'s `main` holds it, so every app change must have landed first; 15's removal of the work email from `package.json` and its boundary lint must be in the tree the split carries), 19 (19's app-repo mode lands the new clone's work in step 11; the split takes the app folder as `ai`'s `main` holds it, so every app change must have landed first; 15's removal of the work email from `package.json` and its boundary lint must be in the tree the split carries)
Plan: [plan.md](plan.md)

Read first: `~/wigley-agents/WigleyRepos.md`, `~/wigley-agents/AgentsStandardMapping.md`,
`~/wigley-agents/MacMachine.md`, `~/.agents/AGENTS.local.md`, `~/wigley-agents/tools/wigley-land/README.md`,
the app's `.agents/skills/install/SKILL.md`, the app `AGENTS.md` § Running and testing.

Every count and line number below was measured at plan time; re-verify each with the command beside it.

## Files

Files (ai):
- modify `wigley-agents/WigleyRepos.md` — § Repos, § Syncing, § Landing, § Root agent files, § Agent files
- modify `wigley-agents/tools/unity-pool/README.md` — the stale `unity-pool.pythonCommand` setting (step 9)
- modify `wigley-agents/AgentsStandardMapping.md` — § Setting up a machine, § Plugins
- modify `wigley-agents/MacMachine.md` — § Environment
- modify `wigley-agents/WindowsMachine.md` — § Environment
- modify `wigley-agents/tools/wigley-land/wigley-land` · `wigley-agents/tools/wigley-land/README.md` · test `wigley-agents/tools/wigley-land/tests/test_wigley_land.py` — only to drop the dead `ai`-repo `node_modules` link (step 9)
- modify `wigley-agents/tools/wigley-repo-files/wigley_repo_files.py` · test `wigley-agents/tools/wigley-repo-files/tests/test_wigley_repo_files.py`
- modify each further file the sweep (step 9) classifies as naming the old path or repo
- delete `wigley-ai-gui/` (the whole folder, one commit)

Files (wigley-ai-gui), in the new clone `~/Documents/wigley-ai-gui`:
- modify `AGENTS.md` — § Running and testing (the `install-app` bullet's "in the `ai` repo, its `wigley-ai-gui` folder", the `start_app.py` bullet's "in the `ai` clone")
- modify `.agents/skills/install/SKILL.md`, `.agents/skills/drive/SKILL.md` where the sweep finds the old path
- modify `agent-plugin/scripts/relay/README.md` — its `wigley-ai-gui/docs/features/…` paths become repo-relative `docs/features/…` (measured at plan time: lines 40 and 43 of the marketplace copy, re-verify in the moved copy)
- modify `CHANGELOG.md` — the move, as a `### Changed` line under `## Unreleased`, which `changelog:release` then puts
  under the second version heading (step 11; step 3 made the first)
- modify each further file the sweep classifies

Files (personal, edited in place, never committed):
- `~/.aliases` · `~/.agents/AGENTS.local.md` · `~/.config/wigley-ai-gui/settings.json` ·
  `~/.config/wigley-ai-gui/scheduled-tasks.json` · `~/.claude/settings.json` · `~/.codex/config.toml` ·
  `~/.agents/wigley-docs/config.json`
- `~/.claude/plugins/known_marketplaces.json` and `installed_plugins.json`, written only by `claude plugin` commands
  (step 8), never by hand

Bookkeeping: none.

## Consumes

- `AGENT_PLUGIN_FOLDER = 'agent-plugin'` ← 01 (the marker `wigley-land` uses to recognise the app repo, and the
  folder the auri plugin update watches).
- `.claude-plugin/marketplace.json`, marketplace name `auri`, so the plugin key is `auri@auri` ← 01.
- `wigley-land`'s app-repo mode (the `secrets` stage, the auri update) ← 19.
- The boundary lint, the changelog lint and the README coverage test ← 15 (run in step 11 from the new clone).

## Produces

- `git@github-personal:JonathonWigley/wigley-ai-gui.git` `main`: the app's whole history, split from `ai`, scanned and
  rewritten; the old `main` (`7a18ac69efadae898ca711b89690631ad7a14459`) gone from its refs.
- The clone `~/Documents/wigley-ai-gui`, with `user.name JonathonWigley` and
  `user.email 17443783+JonathonWigley@users.noreply.github.com` in its own `.git/config`.
- `ai` without its `wigley-ai-gui/` folder.
- The installed `/Applications/wigley-ai-gui.app` built from the new clone, so its baked `WIGLEY_CLONE_DIR` is
  `~/Documents/wigley-ai-gui`.
- `auri@auri` installed for terminal Claude Code from the marketplace at `~/Documents/wigley-ai-gui`: one install,
  which both profiles see because `~/.claude-personal/plugins` links to `~/.claude/plugins`.
- The plan folder at `~/Documents/wigley-ai-gui/docs/features/shareable-app/plan-shareable-app/`, re-reported with
  `set_workflow_plan`.

## Decisions

Settled in the interview (rounds 2–4): `git subtree split --prefix=wigley-ai-gui` of `ai`; TruffleHog with
verification on and Betterleaks; findings to the user before any rewrite; rewrite with `git-filter-repo`; re-scan a
fresh clone; one force push replacing `main`, keeping no copy of the old history on GitHub; each tool install and the
force push are per-run asks; clone at `~/Documents/wigley-ai-gui`; move `node_modules` rather than reinstall; remove
`ai`'s folder in a commit; Betterleaks in the app's landing check after the move; the user turns on GitHub secret
scanning and push protection.

Settled while drafting (Decided notices for the run):

- **The user runs the installs.** `~/.claude/settings.json` deny-lists `Bash(brew install:*)`, so the agent cannot run
  one. The per-run ask is a forms round whose choice is the user running, in a terminal,
  `brew install trufflehog`, `brew install betterleaks` and `brew install git-filter-repo` (TruffleHog and Betterleaks
  from their READMEs; `git-filter-repo` from its INSTALL.md, which lists Homebrew among its packagers but prints no
  literal command, so the agent checks `command -v git-filter-repo` after). One question per tool, each with its
  homepage, since the gate is per package.
- **Land before the split.** The split reads `ai`'s `main`, so the run's branch lands first:
  `wigley-land <run worktree>` under the standing landing yes. The plan folder then lives at
  `~/Documents/ai/wigley-ai-gui/docs/features/shareable-app/plan-shareable-app/`; re-report it with
  `set_workflow_plan`. The rest of this task's `ai` edits go in a fresh `ai` worktree per `WigleyRepos.md` § Landing.
- **Freeze the app folder in `ai`.** Post a `heads-up` in the chatroom before the split: no session commits under
  `ai`'s `wigley-ai-gui/` until the removal lands. Before the removal commit, run
  `git -C ~/Documents/ai rev-list <split base>..main -- wigley-ai-gui`. Any commit it lists is ported to the new
  clone with `git -C ~/Documents/ai format-patch --relative=wigley-ai-gui -o <scratch>/port <split base>..main -- wigley-ai-gui`
  and `git -C ~/Documents/wigley-ai-gui am <scratch>/port/*.patch`, then landed there.
- **Scratch layout.** Every intermediate repo lives under the session scratchpad (`<scratch>` below), never beside
  the user's clones: `split.git` (bare, the raw split), `old.git` (mirror of the current GitHub `main`),
  `rewrite.git` (mirror the rewrite runs in), `verify.git` (fresh mirror of the rewrite, for the re-scan), and the
  scan reports. They hold findings, so they are deleted at the end of the task.
- **Scan the old GitHub history too.** `7a18ac69…` is not in `ai` and nobody has scanned it. It is the user's own repo,
  not third-party code, so the agent mirrors it into `old.git` and scans it with both tools: a live secret there was
  already pushed and needs rotating even though the force push replaces it. The force push then removes it from the
  repo's refs; `old.git` is deleted after, keeping no copy.
- **Branches with unlanded app work.** Measured at plan time: `spike/live-window-view` holds 6 commits,
  `spike/work-inbox` 3 and `work-inbox` 1 under `wigley-ai-gui` that `main` lacks; `shareable-app` (2) is this run's
  own branch and lands in step 3 (re-verify:
  `for b in $(git -C ~/Documents/ai for-each-ref --format='%(refname:short)' refs/heads); do echo "$b $(git -C ~/Documents/ai rev-list --count main..$b -- wigley-ai-gui)"; done`).
  This is one question per branch for the user in the findings round, recommending: split the branch too, rewrite it
  with `main`, and keep it as a local branch in the new clone, unpushed; `ai`'s branches stay until the user deletes
  them.
- **Peer sessions' work.** Measured at plan time: the Work Inbox session holds the worktrees
  `~/Documents/.worktrees/ai-work-inbox` (`spike/work-inbox`) and `~/Documents/.worktrees/ai-work-inbox-plan`
  (`work-inbox`); re-verify with `git -C ~/Documents/ai worktree list` and the chatroom board. Before the split, post a
  `heads-up` to each owning session, by its session title, naming the split, the freeze and the removal of `ai`'s
  `wigley-ai-gui/`, and asking for any unpushed app work. Its answer goes into the findings round's question for that
  branch. This task never removes, resets or commits in another session's worktree.
- **The app repo's landing.** `WigleyRepos.md` § Landing gains the app repo: the standing yes for the merge into
  `main` and the push of `main` covers `JonathonWigley/wigley-ai-gui` too (plan Design Overview, rounds 2 and 3).
  Worktrees go at `~/Documents/.worktrees/wigley-ai-gui-<slug>`, made with
  `git -C ~/Documents/wigley-ai-gui worktree add -b <slug> ../.worktrees/wigley-ai-gui-<slug> main`, and link
  `node_modules` with `ln -s ~/Documents/wigley-ai-gui/node_modules <worktree>/node_modules`. A force push stays
  outside the standing yes.
- **`wigley-land` in the app repo** is task 19's: by step 11 it lands the new clone's work, runs Betterleaks over
  the range (stage `secrets`) and updates `auri@auri`. This task only uses it.
- **`wigley-repo-files`.** `REPO_ROOT` matches `…/wigley-ai-gui` already, so the clone at
  `~/Documents/wigley-ai-gui` is found. It gains an alternative for the app repo's worktrees,
  `…/.worktrees/wigley-ai-gui-<slug>`, while `…/wigley-ai-gui-old` and `…/.wigley-ai-gui-build` stay unmatched (the
  existing `name prefix` and `build sibling` rows).
- **The build worktree.** `scripts/install-steps.mts` puts it beside the git checkout and builds in
  `relative(gitRoot, repoRoot)`: today `~/Documents/.wigley-ai-gui-build/wigley-ai-gui`, registered as a worktree of
  `ai` (`git -C ~/Documents/ai worktree list`). After the move it is `~/Documents/.wigley-ai-gui-build` itself, a
  worktree of the new clone. To keep its installed `node_modules` (and the lockfile hash `install-app` stores in it):
  move `~/Documents/.wigley-ai-gui-build/wigley-ai-gui/node_modules` to `<scratch>/build-node_modules`; run
  `git -C ~/Documents/ai worktree remove ~/Documents/.wigley-ai-gui-build` (no `--force`; a refusal goes to the user);
  run `git -C ~/Documents/wigley-ai-gui worktree add --detach ~/Documents/.wigley-ai-gui-build main`; move the saved
  folder to `~/Documents/.wigley-ai-gui-build/node_modules`. `install-app` then finds the worktree and skips `npm ci`
  while the lockfile hash matches. If it would run `npm ci` anyway, stop and ask the user first (third-party gate).
- **The dev clone's ignored folders.** Measured at plan time, `ai`'s `wigley-ai-gui/` holds ignored `node_modules/`,
  `.drive/`, `.selftest/`, `.vite/` and `.plugin-types/` (`git -C ~/Documents/ai status --short --ignored -- wigley-ai-gui`).
  `node_modules/` and `.drive/` move into the new clone with `mv`; `.selftest/`, `.vite/` and `.plugin-types/` are
  regenerated build output and are deleted with the folder. Report each move and deletion.
- **Reinstall before the removal.** The installed app reads its `default` layouts live from its baked clone dir. The
  install from the new clone (step 8) therefore runs before `ai`'s removal commit lands, so the running app never
  loses its clone.
- **Projects and tasks.** `chat.projects` in `~/.config/wigley-ai-gui/settings.json` keeps `Wigley AI Dev`
  (`~/Documents/ai`, which still holds the other three folders) and gains `{ "name": "Auri", "folder": "~/Documents/wigley-ai-gui" }`.
  The harness-watch tasks (`6ee0e828`, `01eaa27e`) keep their `Wigley AI Dev` target; only their prompts' paths change:
  `~/Documents/ai/wigley-ai-gui` → `~/Documents/wigley-ai-gui`, its `docs/features/` and `src/plugins/`. Task
  `01eaa27e`'s prompt names `~/Documents/ai/wigley-ai-gui/plugins/`, which does not exist; it becomes
  `~/Documents/wigley-ai-gui/src/plugins/` (report it as a stale path fixed). Edit the prompts with the app's
  `update_scheduled_task` tool, which keeps the running app's queue in step.
- **Aliases.** `~/.aliases` keeps `alias goai="cd ~/Documents/ai/"` (line 227 at plan time) and gains
  `alias gogui="cd ~/Documents/wigley-ai-gui/"` on the line after it. `goauri` (line 225) is an unrelated Unity repo
  and stays.
- **Windows.** `WindowsMachine.md` names the Windows clone at `D:\wigley-ai-gui\`, beside `D:\ai\`. Cloning it on that
  machine is the user's next session there; the wrap-up names it.
- **Agent settings.** Edits to `~/.claude/settings.json` (the `autoMode.allow` landing entry, and any marketplace
  entry naming the old app path) and `~/.codex/config.toml` change the agent's own settings, which the auto-mode
  classifier gates: ask in a one-line chat message naming the edit, or tag the approving choice `approves` in a forms
  round (`ClaudeCode.md` § Harness).
- **Learning ledger.** `wigley-agents/learning/` names the app's old paths in past sessions and candidates (measured at
  plan time: `sessions.md` 70 mentions, `INDEX.md` 25, 22 candidate files). The retro alone edits it
  (`AgentsStandardMapping.md` § Plugins), and its lines record past sessions, so the sweep leaves it and lists it as
  excluded.

## Steps

1. **Preconditions.** Re-run each: `git ls-remote git@github-personal:JonathonWigley/wigley-ai-gui.git` shows
   `refs/heads/main` at `7a18ac69…` and no other refs (a `refs/pull/*` would keep old objects reachable: report it);
   `git -C ~/Documents/ai log --format='%ae%n%ce' -- wigley-ai-gui | sort -u` prints only
   `17443783+JonathonWigley@users.noreply.github.com`; `git -C ~/Documents/ai status --porcelain -- wigley-ai-gui` is
   empty; the branch count above.
2. **Installs (per-run ask).** A forms round, one question per tool, asking the user to run its `brew install` and
   recommending yes. Then `command -v trufflehog betterleaks git-filter-repo` prints three paths.
3. **Land and freeze.** `wigley-land <run worktree>`: its `release` stage runs `npm run changelog:release` in the
   worktree's `wigley-ai-gui/` and commits the first heading, `1.1.0` (task 15; review finding 16); re-report the plan folder; chatroom `heads-up` freezing `ai`'s `wigley-ai-gui/`, to the
   thread and to each peer session named in Decisions › Peer sessions' work. Record `ai`'s `main` sha as
   `<split base>`.
4. **Split.** `git -C ~/Documents/ai subtree split --prefix=wigley-ai-gui main -b split/main` (the page's synopsis:
   `git subtree -P <prefix> split [<local-commit>]`; `-b` makes a branch that must not exist). For each branch the
   user chose to carry: `git -C ~/Documents/ai subtree split --prefix=wigley-ai-gui <branch> -b split/<branch>`. Then
   `git init --bare <scratch>/split.git`, `git -C ~/Documents/ai push <scratch>/split.git split/main:refs/heads/main`
   (plus each carried branch), and `git -C ~/Documents/ai branch -D split/main` (and each `split/<branch>`): the agent
   made those branches and they leave `ai` as they came. Check: `git -C <scratch>/split.git ls-tree --name-only main`
   lists `package.json` and `agent-plugin` at the root.
5. **Scan.** Mirror the old GitHub `main`: `git clone --mirror git@github-personal:JonathonWigley/wigley-ai-gui.git <scratch>/old.git`.
   For each of `split.git` and `old.git`, both scanners offline (no credential leaves the machine):
   - `trufflehog git file://<scratch>/<repo> --bare --no-verification --no-update --json > <scratch>/trufflehog-<repo>.json`
     (`trufflehog git --help`, 3.100.1: `--bare` scans a bare repo, which has no `.git` folder and errors without it;
     `--no-verification` skips the live check, so every result is unverified;
     `--no-update` skips its update check);
   - `betterleaks git <scratch>/<repo> "--log-opts=--all --diff-merges=remerge" --no-banner -f json -r <scratch>/betterleaks-<repo>.json`
     (`betterleaks git --help`, 1.10.1: it has no `--include=merges`, and `git log -p` shows no merge diff, so
     `--diff-merges=remerge` adds what each merge's resolution changed; `--all` scans every ref, since custom
     `--log-opts` replace the default; `-f` is the format and `-r` the report path; no `--validation`, so nothing
     goes online); add `--exit-code=10`, so exit 10 alone means findings and any other non-zero exit is a failed scan.
   Also list the user's work email in the split: `git -C <scratch>/split.git log --all -p | command grep -ac '17443783+JonathonWigley@users.noreply.github.com'`
   (one commit added or removed it at plan time: `git log --all -S'peoplefun.com' -- wigley-ai-gui`).
6. **Findings to the user (stop).** One forms round: each finding with its file, commit and detector, never the
   secret's full value (show its first four characters), plus a choice to verify it live. Only for findings the user
   picks to verify, re-run that tool's step 5 scan with the live check on (TruffleHog without `--no-verification`,
   Betterleaks with `--validation`) and add whether each verified to its question. Per finding the choices Rewrite out
   (recommended for any credential), Rotate and rewrite (recommended for a verified one, rotation being the user's),
   or False positive. Plus the work-email rewrite (recommended: replace with the noreply address), the carried
   branches questions (one per branch, with the peer's answer), and a notice that `old.git`'s findings are already on
   GitHub. Two more items, recommending keep: the work email literal sits in this plan's own task documents (this
   file's steps 5 and 7), so the email rule also rewrites that text in the split's copy of the plan; and the home
   path `/Users/jonathonwigley` sits in three `src/plugins/notes/*.test.ts` files and in the plan documents. Each is
   cosmetic; the user picks scrub or keep. No rewrite runs before this round is answered.
7. **Rewrite.** Write `<scratch>/replace.txt` from the answers: `17443783+JonathonWigley@users.noreply.github.com==>17443783+JonathonWigley@users.noreply.github.com`
   and one line per finding to remove (literal by default, `regex:` for a pattern; a line with no `==>` becomes
   `***REMOVED***`). `git clone --mirror --no-local <scratch>/split.git <scratch>/rewrite.git`, then in it
   `git filter-repo --replace-text <scratch>/replace.txt` (plus `--replace-message <scratch>/replace.txt` when a
   finding sits in a commit message; check that flag on the same man page before using it). Never pass `--force`: a
   refusal of the fresh-clone check means the clone was wrong, so make it again. `filter-repo` removes the `origin`
   remote, which is wanted here.
8. **Re-scan, push, clone, install.**
   - `git clone --mirror --no-local <scratch>/rewrite.git <scratch>/verify.git`; run both scans of step 5 on it.
     Done when neither reports a finding the user marked for removal and the email grep prints 0.
   - **Force push (per-run ask).** A one-line chat message naming the push, the branch and that it discards
     `7a18ac69…`; on the user's chat yes:
     `git -C <scratch>/rewrite.git push --force git@github-personal:JonathonWigley/wigley-ai-gui.git main:main`.
     Only `main` is pushed. Check: `git ls-remote …` shows `main` at `rewrite.git`'s `main`.
   - `git clone git@github-personal:JonathonWigley/wigley-ai-gui.git ~/Documents/wigley-ai-gui`; set
     `user.name` and `user.email` there with `git config` (no `--global`). Fetch each carried branch from
     `rewrite.git` as a local branch.
   - Move `node_modules/` and `.drive/` from `~/Documents/ai/wigley-ai-gui/`; swap the build worktree (Decisions).
   - Re-report the plan folder at its new path with `set_workflow_plan`; make continues in the new clone.
   - Install with the app's `install` skill from the new clone. Check:
     `codesign -d -r- /Applications/wigley-ai-gui.app` names `certificate leaf`, and
     `strings /Applications/wigley-ai-gui.app/Contents/Resources/app.asar | command grep -a 'Documents/wigley-ai-gui' | head -1`
     prints the new path while `command grep -ac 'Documents/ai/wigley-ai-gui'` over the same output prints 0.
   - Install `auri` for terminal sessions (task 14 left this here): `claude plugin marketplace add
     ~/Documents/wigley-ai-gui`, then `claude plugin install auri@auri`. Run each once: `~/.claude-personal/plugins` is
     a symlink to `~/.claude/plugins`, so the one install serves both profiles. This is the user's own plugin from the
     user's own clone, not third-party code. The commands write `~/.claude/plugins/known_marketplaces.json` and
     `installed_plugins.json`; when the auto-mode classifier gates them, ask in a one-line chat message. For Codex,
     the commands task 01 checked against the Codex plugin docs. Check: `claude plugin list` and
     `CLAUDE_CONFIG_DIR=~/.claude-personal claude plugin list` both show `auri@auri`, and `known_marketplaces.json`'s
     `auri` entry has `path` `/Users/jonathonwigley/Documents/wigley-ai-gui`.
9. **Sweep.** Every machine reference to the app's old path or repo. Classify each hit as *path or repo* (edit) or
   *name only* (leave: the app is still called wigley-ai-gui). Measured members to start from, each re-verified:
   - `ai`: `WigleyRepos.md` § Repos (four folders → three, plus the app's own repo and its clone), § Syncing, § Landing
     (the app repo's worktree, link, standing yes and Betterleaks step), § Root agent files (unchanged wording, the
     app's `AGENTS.md` still over 100k), § Agent files ("All four folders follow the open AGENTS.md standard" at line
     99: three folders now, and the app repo too); `AgentsStandardMapping.md` § Setting up a machine (clone the app at
     `~/Documents/wigley-ai-gui`, `D:\wigley-ai-gui\` on Windows) and § Plugins (auri's marketplace);
     `MacMachine.md` and `WindowsMachine.md` § Environment; `wigley-land`'s `ai`-repo `NODE_MODULES_LINK`
     (`wigley-ai-gui/node_modules`), its README lines on that link and the tests that seed it, dead once `ai` holds no
     app folder: drop them (19 added the app repo's root link and keeps it); `wigley-repo-files`; the `wigley` chatroom skill's
     "`wigley-ai-gui/docs/features/chatroom/design.md` in the `ai` clone" (if task 13 or 01 left the skill in the
     marketplace); `wigley-agents/tools/unity-pool/README.md` line 905, which names a `unity-pool.pythonCommand`
     setting the app never had (stale today, not renamed by 11): it names the settings the landed unity-pool manifest
     and `programs.python` hold.
   - The new clone: `AGENTS.md`, `.agents/skills/install/SKILL.md`, `.agents/skills/drive/SKILL.md`,
     `agent-plugin/scripts/relay/README.md` and `start_app.py`, every doc outside `docs/features/` naming
     `wigley-ai-gui/` as a folder of another repo. Test fixtures with `ai-dev` or `wigley-ai-gui/` paths are data and
     stay.
   - Personal: `~/.agents/AGENTS.local.md` § Clones (add the app clone) and § Tools; `~/.aliases`;
     `~/.config/wigley-ai-gui/settings.json`; `scheduled-tasks.json`; `~/.claude/settings.json` (`autoMode.allow`'s
     landing entry names `ai` "holding the folders wigley-agents, wigley-ai-gui, …": add the app repo and its clone,
     force push still blocked; any `extraKnownMarketplaces` entry for auri at the old path); `~/.codex/config.toml`
     (add `[projects."/Users/jonathonwigley/Documents/wigley-ai-gui"]` with `trust_level = "trusted"`, and re-point
     any auri marketplace source); `~/.claude/hooks/`.
   - Personal, found by the plan's cold read: `~/.agents/wigley-docs/config.json` (its `roots` hold `~/Documents/dev`
     and `~/Documents/ai`, so the new clone falls outside both: add `~/Documents/wigley-ai-gui` to `roots` and
     `~/Documents/wigley-ai-gui/.drive/*` and `~/Documents/wigley-ai-gui/.selftest/*` to `ignore`, beside the
     `~/Documents/ai/*/` ones). Regenerated, listed and not edited: `~/.agents/wigley-docs/index.json` (rebuilt by the
     docs index) and `~/.agents/wigley-ai-gui-dev/endpoint.json` (its `launch.cwd` names the old folder until the next
     `npm start` in the new clone rewrites it). `~/.claude/plugins/known_marketplaces.json` gets `auri` only through
     step 8's commands.
   - Checked and empty at plan time, re-checked: `~/.local/bin` symlinks into the app
     (`find ~/.local/bin -type l -exec readlink {} \; | command grep -a wigley-ai-gui`), `~/Library/LaunchAgents`
     (`command grep -rl 'wigley-ai-gui' ~/Library/LaunchAgents`), `ai`'s root files and git hooks
     (`wigley-ai-marketplace/scripts/git-hooks/pre-push`), `check_pointers.py`'s scan roots, the retro and transcript
     scripts, `wigley-harness`.
   - Features home: the app's `docs/features/` moved with it and stays in-repo (a plain root `docs/features/`); no
     `~/wigley-features/wigley-ai-gui/` exists (`ls -d ~/wigley-features/wigley-ai-gui`).
   - Edit for the sweep to make: `wigley-ai-marketplace/AGENTS.md` § Changing a plugin reads "a change to either
     section is made to that copy in the same commit" for the `auri.json` fixture; once the app is its own repo the
     copy and its source cannot share a commit, so reword it to one commit per repo, each landing with its own side.
10. **Remove `ai`'s copy.** First restart every app session started before step 8's install, the dev app's and the
    installed app's (review finding 6): each launched with `--plugin-dir ~/Documents/ai/wigley-ai-gui/agent-plugin`,
    and once that folder is gone each `auri` hook's bare `python3 <script>` fails on the missing script: a session
    started before `51f9de6a1` is blocked (exit 2), and a later one fails open silently and loses the gates. Quit the
    dev app started from `~/Documents/ai/wigley-ai-gui` and the installed app, start them again (the dev app from
    `~/Documents/wigley-ai-gui`), and restart their sessions. Peers' sessions and this one are the user's to restart:
    ask in a forms round, one choice per way to restart, and wait for the answer. Then, in an `ai` worktree: run the
    freeze check (Decisions), then `git rm -r -q wigley-ai-gui` and commit with the sweep's `ai` edits ("Move
    wigley-ai-gui to its own repo, JonathonWigley/wigley-ai-gui, …"); `wigley-land` it. Then delete what is left of
    `~/Documents/ai/wigley-ai-gui/` (the regenerated folders), and report it. Post a chatroom `result` lifting the
    freeze and naming the new clone.
11. **Land in the new clone.** Before the first app-repo landing, confirm the `auri` marketplace from the new clone
    is added (step 8; `known_marketplaces.json`'s `auri` `path` is `/Users/jonathonwigley/Documents/wigley-ai-gui`), and
    run `wigley-land`'s pinned argv by hand once in the new clone:
    `betterleaks git ~/Documents/wigley-ai-gui "--log-opts=--diff-merges=remerge HEAD~1..HEAD" --redact --no-banner --exit-code=10; echo $?`
    (checked against `betterleaks git --help` 1.10.1 in review finding 1). Exit 0 confirms the argv. Any other exit
    code (126 for an unknown flag, 1 for an error, 10 for a leak in that commit) stops this task with a report naming the
    code and the last stderr line; the tool's argv is fixed before any app-repo `wigley-land`.
    Then commit the app-side sweep and the `CHANGELOG.md` `### Changed` line there, through a
    worktree per the new § Landing. Land with `wigley-land` (19's app-repo mode): its `release` stage writes and
    commits the second heading, and it runs Betterleaks on the range. Check its output names `released auri
    <version>` and the `secrets` stage as run, not skipped. Delete `<scratch>`'s
    repos, reports and `replace.txt`.

## GIVEN / WHEN / THEN

- GIVEN a path under `~/Documents/.worktrees/wigley-ai-gui-x/src` WHEN `wigley-repo-files` runs THEN it reminds the
  session of `~/Documents/.worktrees/wigley-ai-gui-x/AGENTS.md`.

## Tests

`wigley-land`: the tests that seed `wigley-ai-gui/node_modules` in an `ai` fixture go with the dropped link; 19's
app-repo tests stay.

`wigley-repo-files` (`tests/test_wigley_repo_files.py`, its table of `(name, path, tool, input, expected root)`): a
row `app worktree` for `…/.worktrees/wigley-ai-gui-x` — catches app worktrees getting no reminder; the existing
`build sibling` and `name prefix` rows keep catching false matches.

## Verification

```
cd ~/wigley-agents/tools/wigley-land && python3 -m unittest discover -s tests
cd ~/wigley-agents/tools/wigley-repo-files && python3 -m unittest discover -s tests
git ls-remote git@github-personal:JonathonWigley/wigley-ai-gui.git
git -C ~/Documents/wigley-ai-gui config user.email
git -C ~/Documents/ai ls-files wigley-ai-gui | wc -l          # 0
git -C ~/Documents/ai worktree list                            # no .wigley-ai-gui-build
git -C ~/Documents/wigley-ai-gui worktree list                 # holds ~/Documents/.wigley-ai-gui-build
```

The stale-reference proof, the task's last check: it prints nothing.

```
command grep -rIn --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=learning --exclude-dir=archive \
  -e 'Documents/ai/wigley-ai-gui' -e 'ai/wigley-ai-gui' -e '<clone>/wigley-ai-gui' -e 'D:\\ai\\wigley-ai-gui' \
  -e "ai\`'s \`wigley-ai-gui\`" -e 'its `wigley-ai-gui` folder' -e 'wigley-ai-gui/node_modules' \
  ~/Documents/ai ~/Documents/wigley-ai-gui/AGENTS.md ~/Documents/wigley-ai-gui/README.md \
  ~/Documents/wigley-ai-gui/.agents ~/Documents/wigley-ai-gui/agent-plugin \
  ~/.agents/AGENTS.local.md ~/.aliases ~/.config/wigley-ai-gui ~/.claude/settings.json ~/.claude/hooks \
  ~/.claude/plugins/known_marketplaces.json ~/.claude/plugins/installed_plugins.json \
  ~/.agents/wigley-docs/config.json ~/Documents/.wigley-ai-gui-build/AGENTS.md ~/Documents/.wigley-ai-gui-build/.agents \
  ~/.codex/config.toml ~/.codex/AGENTS.md
command grep -n 'Documents/ai/wigley-ai-gui' ~/.agents/wigley-ai-gui-dev/endpoint.json   # regenerated: may print until the next npm start
find ~/.local/bin -type l -exec readlink {} \; | command grep -a 'ai/wigley-ai-gui'
command grep -rl 'ai/wigley-ai-gui' ~/Library/LaunchAgents
```

A hit the worker judges historical (a changelog entry, a `docs/features/` design describing the old layout) is
listed in the report with why it stays, never silently filtered.

## Done when

- `main` of `JonathonWigley/wigley-ai-gui` is the rewritten split; the re-scan of `verify.git` reports nothing the user
  marked for removal; no copy of the old history remains in `<scratch>`.
- `~/Documents/wigley-ai-gui` is a clone with the noreply identity, `node_modules` moved in, the plan folder in it and
  re-reported.
- `ai` holds no `wigley-ai-gui/` and its landing is pushed.
- The installed app bakes the new clone path.
- Both test suites pass; the stale-reference proof prints nothing (the `endpoint.json` line excepted, listed as
  regenerated).
- `claude plugin list` shows `auri@auri` in both profiles, its marketplace path being the new clone.
- The report lists every sweep member added beyond the measured list, every file classified name-only, each moved or
  deleted folder, and the scan results by tool and repo.
- The wrap-up's Still open names: GitHub secret scanning and push protection, which the user turns on under the repo's
  **Settings → Advanced Security** (GitHub's docs page states it for public repos; for a private personal repo the
  option may be absent, which the user sees there); the Windows clone at `D:\wigley-ai-gui\`; any rotation the
  findings round handed the user.

Commit: one commit in `ai` (tools, docs, removal); one landing in the new clone (app-side sweep, `CHANGELOG.md`).

## Proof

Commit ac41bbcd4 · proof: split, offline scans (23 false positives cleared by the user), rewrite, force push, clone and sweep done; ai main ac41bbcd4 holds no wigley-ai-gui file; app main 1cdb46d30; wigley-land 43 and wigley-repo-files 7 tests OK; stale-reference grep prints nothing · concerns: TruffleHog needs --bare on a bare mirror; three peer app commits landed in ai after the split and were ported; wigley-land's ai-mode app_folder release is dead code now that ai holds no app
