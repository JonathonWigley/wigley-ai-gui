"""Finds every agent doc the index records and turns each into Entry records:
the global layer under the home folder, each Claude config folder and each
global folder the contributions file names, the installed plugins from every
config folder's install records, every git repo under the config roots — a
linked worktree skipped as an ignored repo is — with an in-repo feature home
at each in-repo folder the contributions file's features homes name, below
its root and below each project folder directly under its root that holds an
AGENTS.md (each a plain folder, not a link and not a repo of its own), and
the feature homes in each out-of-repo features folder. With no features homes
in the contributions file there is no feature home. Every marketplace clone under the
config roots — a repo holding .claude-plugin/marketplace.json — has each
plugin it lists walked from its source folder as a plugin install is, that
folder registered as an owner root of the clone plugin's owner, and a skill
reached by any walk adds a skill-file entry for every other file in its
folder.

The walks share one set of claimed real paths, so a file reached twice —
through a symlink, or a global folder also sitting under a root — is one
entry, its kind set by the first walk that reached it. Every id and path is
the file's real path. Ownership goes by real path, not walk order (see
_Scan.owner_of): a file belongs to the plugin install or feature home that is
the deepest owner root holding its real path, an instructions file in a
feature home looking past it to an in-repo home's repo or the owner root
above, if any; else to the global layer when
a global walk reached it, whatever repo the real path sits in, so a global
folder stays global when it links to a clone; else to the deepest
repo holding it — found by a repo walk or holding a symlink's target — unless
the real path sits in an ignored repo; else to the walk that reached it. Every other path a walk reached the file
by is kept in the entry's walked locations, each paired with the owner of
the walk that reached it, since a harness loads a linked file by where it is
linked from and judges it by that place's owner. Every walk follows a
symlinked folder one level deep through _Scan.walk (the repo walk only inside
a repo's own .claude, .agents and in-repo feature homes, measured from that
repo's root). Generated folders are pruned except inside those folders, linked
folders and the out-of-repo feature homes; every walk prunes .git,
node_modules and a .claude folder's worktrees, and skips each global
folder's skip folders by real path.
Once the walks finish, instruction files found in the context folders'
ancestors are added, every instruction file's @imports are resolved (adding
an entry for each imported file the walks missed outside an ignored repo),
and _Scan.finished_entries settles each entry's owner. Last,
_settle_ownership merges each install file into its counterpart in the
install's source clone, the clone entry carrying the copy in installed, and
marks third-party every file of an install with no source and every synced
skill and its files. Imports nothing from the load-rule modules.
"""

from __future__ import annotations

import fnmatch
import os
import re
from collections import deque
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Callable, Iterator

from config import Config, expand_home
from contributions import Contributions, FeaturesHomes, GlobalFolder
from environment import Environment, PluginInstall, repo_slug, walked_path
from markdown import (GIST_LIMIT, checkbox_counts, followup_items, front_matter, heading_title, imports,
                      read_exact_text, split_lines, status_line)
from model import IMPORT_HOPS, Entry, Installed, Location, Owner
from rules import is_repo_root, repo_roots_holding

INSTRUCTION_NAMES = ("CLAUDE.md", "CLAUDE.local.md", "AGENTS.md", "AGENTS.override.md")
ANCESTOR_INSTRUCTION_FILES = (*INSTRUCTION_NAMES, ".claude/CLAUDE.md", ".claude/AGENTS.md")
GENERATED_FOLDERS = frozenset({
    "node_modules", "Library", "build", "dist", "out", "obj", "Temp", "Logs", ".git", "__pycache__",
    ".venv", "venv", "PackageCache",
})
GIT_FOLDER = ".git"
ALWAYS_PRUNED_FOLDERS = frozenset({GIT_FOLDER, "node_modules"})
WORKTREES_FOLDER = "worktrees"
GITDIR_PREFIX = "gitdir:"
WORKTREE_COMMONDIR_FILE = "commondir"
SETTINGS_FILES = ("settings.json", "settings.local.json")
AGENT_FOLDERS = (".claude", ".agents")
PROJECT_INSTRUCTIONS = "AGENTS.md"
LEARNING_SUBFOLDER = "learning"
ANNOTATION_FILE = "annotations.*.local.md"
TASK_FILE = re.compile(r"^\d\d-.+\.md$")
IMPLICIT_INVOCATION_OFF = re.compile(r"allow_implicit_invocation:\s*false")
MARKETPLACE_FILE = (".claude-plugin", "marketplace.json")
LOCAL_SOURCE_PREFIX = "./"
SKILL_FILE = "SKILL.md"
BINARY_SNIFF_BYTES = 8192
SYNCED_SKILLS = ("skills", "synced")


@dataclass
class Discovery:
    entries: list[Entry]
    context_folders: list[Path]
    repo_names: dict[str, str]  # real repo root → origin name, for each repo the scan named
    in_repo_feature_homes: dict[str, str]  # real path of an in-repo feature home → real root of its repo


GLOBAL = Owner("global")


@dataclass(frozen=True)
class _MarketplaceClone:
    """One marketplace clone: its real root, its origin's repo_slug, the
    marketplace name its marketplace.json gives, and each walkable plugin
    it lists, by name, with its real source folder."""

    root: str
    slug: str | None
    name: str
    plugin_folders: dict[str, str]


def discover(env: Environment, config: Config, contributions: Contributions) -> Discovery:
    """Every doc on the machine, with one context folder per repo root found
    plus the home folder."""
    scan = _Scan(env, config, contributions)
    _walk_global(scan)
    _walk_plugins(scan)
    for root in config.roots:
        if root.is_dir():
            _walk_repos(scan, root)
    for features_folder in scan.out_of_repo_folders:
        if features_folder.is_dir():
            for feature_home in sorted(p for p in features_folder.iterdir() if p.is_dir()):
                _walk_feature_home(scan, feature_home)
    _walk_marketplace_clones(scan)
    context_folders = [Path(root) for root in scan.repo_owners] + [env.home]
    _add_ancestor_instructions(scan, context_folders)
    _resolve_imports(scan)
    entries = _settle_ownership(scan, scan.finished_entries())
    return Discovery(entries=entries, context_folders=context_folders, repo_names=scan.repo_names(),
                     in_repo_feature_homes=scan.in_repo_feature_homes)


def discover_folder(env: Environment, config: Config, contributions: Contributions, folder: Path) -> Discovery:
    """The docs a session opened in folder can reach: the global layer, the
    plugins, the outermost non-ignored repo holding folder (walked whole) and
    the feature homes of the repos holding it. A folder in no repo walks the
    config roots at or below it instead, or itself when it sits under a root,
    so its repos below match build's. The marketplace clones under the config
    roots are walked either way, so an install with a source finds it."""
    scan = _Scan(env, config, contributions)
    _walk_global(scan)
    _walk_plugins(scan)
    real_folder = Path(os.path.realpath(folder))
    holding_roots = repo_roots_holding(real_folder)
    kept_roots = []
    for root in reversed(holding_roots):
        if scan.is_ignored(str(root)):
            break
        kept_roots.append(root)
    if kept_roots:
        _walk_repos(scan, kept_roots[0])
    elif not holding_roots:
        for top in _roots_at_or_below(config.roots, real_folder):
            _walk_repos(scan, top)
    repo_names = {scan.repo_owners[str(root)].repo for root in kept_roots if str(root) in scan.repo_owners}
    for name in sorted(repo_names):
        for features_folder in scan.out_of_repo_folders:
            feature_home = features_folder / name
            if feature_home.is_dir():
                _walk_feature_home(scan, feature_home)
    _walk_marketplace_clones(scan)
    _add_ancestor_instructions(scan, [folder])
    _resolve_imports(scan)
    entries = _settle_ownership(scan, scan.finished_entries())
    return Discovery(entries=entries, context_folders=[folder], repo_names=scan.repo_names(),
                     in_repo_feature_homes=scan.in_repo_feature_homes)


def _roots_at_or_below(roots: list[Path], real_folder: Path) -> list[Path]:
    """The part of each config root at or below real_folder: the root when it
    sits at or below the folder, the folder when it sits below the root."""
    tops: list[Path] = []
    for root in roots:
        real_root = Path(os.path.realpath(root))
        top = real_root if real_root.is_relative_to(real_folder) else real_folder
        is_overlapping = real_root.is_relative_to(real_folder) or real_folder.is_relative_to(real_root)
        if is_overlapping and top.is_dir() and top not in tops:
            tops.append(top)
    return tops


class _Scan:
    """The entries found so far, keyed by id, the real paths already claimed,
    each real path's walked paths with the owners of the walks that reached
    it, and the owner roots — repos, plugin installs, marketplace clone
    plugin folders and feature homes — that own files by real path, plus the
    plugin installs by real folder and the marketplace clones in walk order,
    which _settle_ownership reads. claim records where a file was reached,
    walk is the one way a folder is walked, and finished_entries settles
    each entry's source fields. features is None when the contributions
    file names no features homes."""

    def __init__(self, env: Environment, config: Config, contributions: Contributions) -> None:
        self.env = env
        self.config = config
        self.global_folders = contributions.global_folders
        self.features: FeaturesHomes | None = contributions.features
        self.in_repo_parts = () if self.features is None else self.features.in_repo_parts
        self.out_of_repo_folders = () if self.features is None else self.features.out_of_repo_folders
        self.home = Path(os.path.realpath(env.home))
        self.entries: dict[str, Entry] = {}
        self.claimed: set[str] = set()
        self.reached_by: dict[str, list[tuple[str, Owner]]] = {}
        self.owner_roots: dict[str, Owner] = {}
        self.repo_owners: dict[str, Owner] = {}  # the repos a repo walk or the marketplace clone search found
        self.plugin_installs: dict[str, list[PluginInstall]] = {}  # real install folder → its installs
        self.marketplace_clones: list[_MarketplaceClone] = []
        self.in_repo_feature_homes: dict[str, str] = {}  # real home path → real root of the repo holding it
        self.link_target_folders: set[str] = set()
        self.skipped_folders = frozenset(os.path.realpath(folder.path / skip)
                                         for folder in self.global_folders for skip in folder.skip)
        self.skipped_names = frozenset(os.path.basename(path) for path in self.skipped_folders)

    def claim(self, path: Path | str, walk_owner: Owner | None) -> str | None:
        """path's real path, or None when it is no file or an earlier walk
        claimed it. Either way path is recorded with walk_owner as a way the
        real path was reached, the first walk to reach a path keeping it, and
        a path that differs from its real path registers the repos holding
        the real one as owner roots. walk_owner is None for a file an @import
        reaches: no walk reached it, so it is owned by its real path alone."""
        real = os.path.realpath(path)
        if not os.path.isfile(real):
            return None
        walked = os.path.abspath(path)
        reached = self.reached_by.setdefault(real, [])
        is_new_path = all(walked != known for known, _ in reached)
        if walk_owner is not None and is_new_path:
            reached.append((walked, walk_owner))
        if walked != real:
            self.register_repos_holding(os.path.dirname(real))
        if real in self.claimed:
            return None
        self.claimed.add(real)
        return real

    def register_repos_holding(self, real_folder: str) -> None:
        """Register each repo holding real_folder as an owner root, outermost
        first, stopping at an ignored one."""
        if real_folder in self.link_target_folders:
            return
        self.link_target_folders.add(real_folder)
        for root in reversed(repo_roots_holding(Path(real_folder))):
            if self.is_ignored(str(root)):
                break
            self.repo_owner(str(root))

    def finished_entries(self) -> list[Entry]:
        """Every entry, owned by owner_of its real path, with each other path
        it was reached by as a Location owned by the walk that reached it so.
        An entry no claim recorded, a plugin's own entry, keeps its owner."""
        finished = []
        for entry in self.entries.values():
            reached = self.reached_by.get(entry.path)
            if reached is None:
                finished.append(entry)
                continue
            owner = self.owner_of(entry.path, entry.kind, [walk_owner for _, walk_owner in reached])
            walked = tuple(Location(path, walk_owner) for path, walk_owner in reached if path != entry.path)
            finished.append(replace(
                entry, source=owner.source, repo=owner.repo, root=owner.root, plugin=owner.plugin, walked=walked,
            ))
        return finished

    def owner_of(self, real_path: str, kind: str, walk_owners: list[Owner]) -> Owner:
        """Who owns real_path, an entry of kind, given the owners of the walks
        that reached it: the deepest owner root holding it when that is a
        plugin install or feature home — an instructions file in a feature
        home looks past the home to owner_above_home; else GLOBAL
        when a global walk reached it; else the deepest repo holding it,
        unless the real path sits in an ignored repo; else the first walk
        that reached it, GLOBAL when none did (a file only an @import
        reached)."""
        held = self.root_owner(real_path)
        is_instructions_in_feature_home = kind == "instructions" and held is not None and held.source == "features"
        if is_instructions_in_feature_home:
            held = self.owner_above_home(held)
        if held is not None and held.source != "repo":
            return held
        if GLOBAL in walk_owners:
            return GLOBAL
        if held is not None and not self.is_in_ignored_repo(Path(real_path).parent):
            return held
        return walk_owners[0] if walk_owners else GLOBAL

    def owner_above_home(self, home: Owner) -> Owner:
        """The owner an instructions file in feature home looks past it to:
        an in-repo home's repo; else the deepest owner root above the home;
        else the home."""
        repo_root = self.in_repo_feature_homes.get(home.root)
        if repo_root is not None:
            return self.owner_roots[repo_root]
        return self.root_owner(os.path.dirname(home.root)) or home

    def root_owner(self, real_path: str) -> Owner | None:
        """The owner of the deepest owner root at or above real_path, or None."""
        path = Path(real_path)
        for folder in (path, *path.parents):
            owner = self.owner_roots.get(str(folder))
            if owner is not None:
                return owner
        return None

    def walk(self, top: Path | str, prunes_generated: Callable[[str, bool], bool] | None = None,
             follows_link: Callable[[str, str], bool] | None = None,
             ) -> Iterator[tuple[str, list[str], list[str], bool, bool]]:
        """os.walk over top that also walks each symlinked folder it meets,
        through the link and one level deep: a link inside a linked folder is
        not followed. Yields (dirpath, dirnames, filenames, is_linked,
        holds_git), holds_git telling whether dirpath is a repo root by
        is_repo_root, read before the cut, and dirnames already cut by kept_folders — generated names only where
        prunes_generated(dirpath, holds_git) holds, never in a linked folder. A caller may
        cut dirnames further before the walk resumes; a linked folder still in
        dirnames is walked when follows_link(dirpath, name) allows it, every
        one when follows_link is None."""
        for dirpath, dirnames, filenames in os.walk(top, followlinks=False):
            holds_git = _holds_git(dirpath, dirnames, filenames)
            prune_generated = prunes_generated is not None and prunes_generated(dirpath, holds_git)
            dirnames[:] = self.kept_folders(dirpath, dirnames, prune_generated)
            yield dirpath, dirnames, filenames, False, holds_git
            for name in dirnames:
                link = os.path.join(dirpath, name)
                if os.path.islink(link) and (follows_link is None or follows_link(dirpath, name)):
                    for linked_dirpath, linked_dirnames, linked_filenames in os.walk(link, followlinks=False):
                        linked_holds_git = _holds_git(linked_dirpath, linked_dirnames, linked_filenames)
                        linked_dirnames[:] = self.kept_folders(linked_dirpath, linked_dirnames, prune_generated=False)
                        yield linked_dirpath, linked_dirnames, linked_filenames, True, linked_holds_git

    def kept_folders(self, dirpath: str, names: list[str], prune_generated: bool) -> list[str]:
        """names in sorted order, less .git, node_modules, a .claude folder's
        worktrees, the global folders' skip folders, and, when
        prune_generated, the other generated folders."""
        is_claude_folder = os.path.basename(dirpath) == ".claude"
        kept = []
        for name in sorted(names):
            is_pruned = (name in ALWAYS_PRUNED_FOLDERS or (prune_generated and name in GENERATED_FOLDERS)
                         or (is_claude_folder and name == WORKTREES_FOLDER))
            is_skipped = (name in self.skipped_names
                          and os.path.realpath(os.path.join(dirpath, name)) in self.skipped_folders)
            if not is_pruned and not is_skipped:
                kept.append(name)
        return kept

    def add(self, entry: Entry) -> None:
        self.entries[entry.id] = entry

    def add_doc(self, kind: str, path: Path, owner: Owner | None) -> Entry | None:
        """One entry for the whole file at path, titled and described by its
        kind, reached by a walk of owner (None for an @import, see claim). A
        skill also walks its folder's other files by add_skill_files, whether
        or not this walk claims the skill."""
        real = self.claim(path, owner)
        if kind == "skill" and os.path.isfile(path):
            self.add_skill_files(path, owner)
        if real is None:
            return None
        text = _read(real)
        entry = _entry(owner or GLOBAL, kind, real, _title(kind, path, text), _doc_meta(kind, path, text))
        self.add(entry)
        return entry

    def add_skill_files(self, skill_path: Path, owner: Owner | None) -> None:
        """One skill-file entry per file in the folder of the skill at
        skill_path but its SKILL.md, walked as reached through skill_path with
        generated folders pruned, a file holding a NUL byte in its first
        BINARY_SNIFF_BYTES skipped. An instruction file there stays
        instructions."""
        folder = skill_path.parent
        skill_md = folder / SKILL_FILE
        skill_id = os.path.realpath(skill_path)
        for dirpath, _, filenames, _, _ in self.walk(folder, prunes_generated=lambda dirpath, holds_git: True):
            for name in sorted(filenames):
                path = Path(dirpath) / name
                if path == skill_md or not os.path.isfile(path) or _holds_nul(path):
                    continue
                if name in INSTRUCTION_NAMES:
                    self.add_doc("instructions", path, owner)
                    continue
                real = self.claim(path, owner)
                if real is not None:
                    title = path.relative_to(folder).as_posix()
                    self.add(_entry(owner or GLOBAL, "skill-file", real, title, {"skill": skill_id}))

    def add_hooks(self, path: Path, owner: Owner) -> None:
        """One entry per hook in the hooks object of a settings or hooks.json file."""
        real = self.claim(path, owner)
        if real is None:
            return
        hooks = self.env.claude_settings(Path(real)).get("hooks")
        if not isinstance(hooks, dict):
            return
        for event, groups in hooks.items():
            for number, (matcher, hook) in enumerate(_event_hooks(groups)):
                self.add(_hook_entry(owner, real, event, number, matcher, hook))

    def add_repo_followup(self, path: Path, owner: Owner) -> None:
        """A repo's docs/followups/<topic>.md, which is one follow-up item."""
        real = self.claim(path, owner)
        if real is None:
            return
        text = read_exact_text(Path(real), errors="replace")
        lines = (line.strip() for line in split_lines(text))
        gist = next((line for line in lines if line and not line.startswith("#")), "")
        meta = {"status": "open", "gist": gist[:GIST_LIMIT], "section": None, "tags": []}
        self.add(_entry(owner, "followup", real, heading_title(text) or path.name, meta, line=1))

    def add_feature_file(self, path: Path, rel_dir: tuple[str, ...], owner: Owner) -> None:
        real = self.claim(path, owner)
        if real is None:
            return
        text = read_exact_text(Path(real), errors="replace")
        kind = _feature_file_kind(self.features, rel_dir, path.name)
        if kind == "followup":
            for item in followup_items(text):
                meta = {"status": item.status, "gist": item.gist, "section": item.section, "tags": item.tags}
                self.add(_entry(owner, "followup", real, item.title, meta, line=item.line))
            return
        checked, total = checkbox_counts(text)
        if kind == "feature":
            meta = {"slug": rel_dir[0], "checked": checked, "total": total}
        elif kind == "task":
            plan = rel_dir[1].removeprefix("plan-") if len(rel_dir) == 2 else None
            meta = {"feature": rel_dir[0], "plan": plan, "status": status_line(text),
                    "checked": checked, "total": total}
        elif kind == "plan":
            meta = {"feature": rel_dir[0], "checked": checked, "total": total}
        else:
            meta = {}
        self.add(_entry(owner, kind, real, heading_title(text) or path.name, meta))

    def repo_owner(self, real_root: str) -> Owner:
        """The owner of the repo at real_root, registered as an owner root."""
        owner = self.owner_roots.get(real_root)
        if owner is None:
            owner = Owner("repo", repo=self.env.origin_name(Path(real_root)), root=real_root)
            self.owner_roots[real_root] = owner
        return owner

    def repo_names(self) -> dict[str, str]:
        """Real root → origin name of each repo with an owner root, keyed by
        the owner's root, so a clone plugin folder names its clone."""
        return {owner.root: owner.repo for owner in self.owner_roots.values() if owner.source == "repo"}

    def is_ignored(self, real_root: str) -> bool:
        """Whether the repo at real_root matches a config ignore pattern or is
        a linked worktree (see _is_linked_worktree)."""
        return (any(fnmatch.fnmatch(real_root, pattern) for pattern in self.config.ignore)
                or _is_linked_worktree(real_root))

    def is_in_ignored_repo(self, real_folder: Path) -> bool:
        return any(self.is_ignored(str(root)) for root in repo_roots_holding(real_folder))


def _walk_global(scan: _Scan) -> None:
    for folder in scan.env.claude_config_dirs:
        _walk_claude_config_dir(scan, walked_path(folder))
    home = scan.home
    codex = home / ".codex"
    scan.add_doc("instructions", codex / "AGENTS.md", GLOBAL)
    scan.add_doc("instructions", codex / "AGENTS.override.md", GLOBAL)
    for path in sorted((codex / "prompts").glob("*.md")):
        scan.add_doc("prompt", path, GLOBAL)
    for path in sorted((home / ".agents" / "skills").glob("*/SKILL.md")):
        scan.add_doc("skill", path, GLOBAL)
    for folder in scan.global_folders:
        _walk_global_folder(scan, folder)


def _walk_global_folder(scan: _Scan, folder: GlobalFolder) -> None:
    """A contributed global folder: each top-level .md file is instructions,
    each of its reference files reference; each subfolder is walked in full,
    a learning subfolder as learning and any other as reference. A folder
    under the home folder is walked under its real path, as the other global
    walks are."""
    top = folder.path
    if top.is_relative_to(scan.env.home):
        top = scan.home / top.relative_to(scan.env.home)
    reference = [top / name for name in folder.reference_files]
    for path in sorted(top.glob("*.md")):
        if path not in reference:
            scan.add_doc("instructions", path, GLOBAL)
    for path in reference:
        scan.add_doc("reference", path, GLOBAL)
    for subfolder in folder.subfolders:
        kind = "learning" if Path(subfolder).name == LEARNING_SUBFOLDER else "reference"
        for path in _markdown_below(scan, top / subfolder):
            scan.add_doc(kind, path, GLOBAL)


def _walk_claude_config_dir(scan: _Scan, claude: Path) -> None:
    """One Claude config folder's user files, at the path a walk sees it by,
    all owned by the global layer."""
    scan.add_doc("instructions", claude / "CLAUDE.md", GLOBAL)
    for path in _markdown_below(scan, claude / "rules"):
        scan.add_doc("rule", path, GLOBAL)
    for path in sorted((claude / "skills").glob("*/SKILL.md")):
        scan.add_doc("skill", path, GLOBAL)
    synced = claude / "skills" / "synced"
    buckets = sorted(p for p in synced.iterdir() if p.is_dir()) if synced.is_dir() else []
    for bucket in buckets:
        if not bucket.name.startswith("."):
            for path in sorted(bucket.glob("*/SKILL.md")):
                scan.add_doc("skill", path, GLOBAL)
    for path in sorted((claude / "agents").glob("*.md")):
        scan.add_doc("subagent", path, GLOBAL)
    for path in _markdown_below(scan, claude / "commands"):
        scan.add_doc("command", path, GLOBAL)
    for name in SETTINGS_FILES:
        scan.add_hooks(claude / name, GLOBAL)


def _walk_plugins(scan: _Scan) -> None:
    """One plugin entry per install folder, registered as an owner root, then
    that folder's components. Every config folder's Claude installs come
    first, in folder order, then Codex's; scan.plugin_installs keeps them
    by folder in that order."""
    claude_installs = [install for folder in scan.env.claude_config_dirs
                       for install in scan.env.claude_plugin_installs(folder)]
    by_folder: dict[str, list[PluginInstall]] = {}
    for install in claude_installs + scan.env.codex_plugin_installs():
        by_folder.setdefault(os.path.realpath(install.install_path), []).append(install)
    scan.plugin_installs = by_folder
    for folder, installs in by_folder.items():
        first = installs[0]
        owner = Owner("plugin", root=folder, plugin=first.key)
        scan.owner_roots[folder] = owner
        scan.add(_entry(owner, "plugin", folder, first.key, _plugin_meta(installs)))
        _walk_plugin_components(scan, Path(folder), owner, first.harness)


def _walk_plugin_components(scan: _Scan, folder: Path, owner: Owner, harness: str) -> None:
    for path in sorted((folder / "skills").glob("*/SKILL.md")):
        scan.add_doc("skill", path, owner)
    if harness == "codex":
        return
    for path in sorted((folder / "agents").glob("*.md")):
        scan.add_doc("subagent", path, owner)
    for path in _markdown_below(scan, folder / "commands"):
        scan.add_doc("command", path, owner)
    scan.add_hooks(folder / "hooks" / "hooks.json", owner)
    scan.add_doc("instructions", folder / "CLAUDE.md", owner)
    scan.add_doc("instructions", folder / "AGENTS.md", owner)


def _walk_marketplace_clones(scan: _Scan) -> None:
    """Every marketplace clone under the config roots, in root order, found
    from folder listings with no link followed: a repo root holding
    MARKETPLACE_FILE that _add_marketplace_clone takes. An ignored repo drops
    itself and every folder below it, and the search looks no deeper than a
    clone."""
    for root in scan.config.roots:
        if not root.is_dir():
            continue
        walk = scan.walk(root, prunes_generated=lambda dirpath, holds_git: True,
                         follows_link=lambda dirpath, name: False)
        for dirpath, dirnames, _, _, holds_git in walk:
            if not holds_git:
                continue
            real_root = os.path.realpath(dirpath)
            if scan.is_ignored(real_root):
                dirnames[:] = []
                continue
            is_clone = (os.path.isfile(os.path.join(dirpath, *MARKETPLACE_FILE))
                        and _add_marketplace_clone(scan, real_root))
            if is_clone:
                dirnames[:] = []


def _add_marketplace_clone(scan: _Scan, real_root: str) -> bool:
    """Whether the repo at real_root is a marketplace clone: its marketplace
    file holds a name string and a plugins list. A clone not yet recorded is
    registered as a repo and recorded in scan.marketplace_clones, and each
    plugin _plugin_source_folders finds is walked as a plugin install is, its
    folder registered as an owner root of the clone plugin's owner, unless a
    plugin install already sits in that folder."""
    marketplace = scan.env.claude_settings(Path(real_root, *MARKETPLACE_FILE))
    name, plugins = marketplace.get("name"), marketplace.get("plugins")
    if not isinstance(name, str) or not isinstance(plugins, list):
        return False
    if any(clone.root == real_root for clone in scan.marketplace_clones):
        return True
    repo = scan.repo_owner(real_root)
    scan.repo_owners[real_root] = repo
    plugin_folders = _plugin_source_folders(real_root, plugins)
    for plugin, folder in plugin_folders.items():
        if folder in scan.plugin_installs:
            continue
        owner = replace(repo, plugin=f"{plugin}@{name}")
        scan.owner_roots[folder] = owner
        _walk_plugin_components(scan, Path(folder), owner, "claude")
    origin = scan.env.origin_url(Path(real_root))
    slug = repo_slug(origin) if origin is not None else None
    scan.marketplace_clones.append(_MarketplaceClone(real_root, slug, name, plugin_folders))
    return True


def _plugin_source_folders(real_root: str, plugins: list) -> dict[str, str]:
    """Plugin name → real source folder of each item of a marketplace file's
    plugins that is an object with a name string and a source string starting
    LOCAL_SOURCE_PREFIX whose real path is a folder inside real_root; the
    first item of a name wins, and every other item is skipped."""
    folders: dict[str, str] = {}
    for item in plugins:
        if not isinstance(item, dict):
            continue
        plugin, source = item.get("name"), item.get("source")
        is_local_source = isinstance(source, str) and source.startswith(LOCAL_SOURCE_PREFIX)
        if not isinstance(plugin, str) or not is_local_source:
            continue
        folder = os.path.realpath(os.path.join(real_root, source))
        if os.path.isdir(folder) and Path(folder).is_relative_to(real_root):
            folders.setdefault(plugin, folder)
    return folders


def _settle_ownership(scan: _Scan, entries: list[Entry]) -> list[Entry]:
    """entries settled against the plugin installs and synced skills. An
    install with a source (see _install_source) gives up each file whose
    _file_key matches a file of the source's plugin: the install's entry
    leaves the list and the clone entry gains it as an Installed copy, in
    install-folder order. Every entry of an install with no source, its
    plugin entry included, is third-party, and so is every entry with a
    location under a Claude config folder's skills/synced."""
    urls = _marketplace_urls(scan) if scan.plugin_installs else {}
    installed: dict[str, list[Installed]] = {}
    dropped: set[str] = set()
    third_party: set[str] = set()
    for folder, installs in scan.plugin_installs.items():
        first = installs[0]
        install_entries = [entry for entry in entries if entry.source == "plugin" and entry.root == folder]
        source = _install_source(scan, first, urls)
        if source is None:
            third_party.update(entry.id for entry in install_entries)
            continue
        counterparts = _clone_plugin_files(entries, *source)
        install_owner = scan.owner_roots[folder]
        for entry in install_entries:
            key = _file_key(entry, folder) if entry.kind != "plugin" else None
            counterpart = counterparts.get(key) if key is not None else None
            if counterpart is not None:
                dropped.add(entry.id)
                copy = Installed(Location(entry.path, install_owner), first.harness, first.version)
                installed.setdefault(counterpart, []).append(copy)
    third_party.update(entry.id for entry in entries if _is_synced_skill_file(scan.env, entry))
    return [replace(entry, ownership="third-party" if entry.id in third_party else entry.ownership,
                    installed=tuple(installed.get(entry.id, ())))
            for entry in entries if entry.id not in dropped]


def _marketplace_urls(scan: _Scan) -> dict[str, dict[str, str]]:
    """Harness → marketplace name → URL: Claude's from every config folder,
    the first folder naming a marketplace winning, and Codex's."""
    claude: dict[str, str] = {}
    for folder in scan.env.claude_config_dirs:
        for name, url in scan.env.claude_marketplace_urls(folder).items():
            claude.setdefault(name, url)
    return {"claude": claude, "codex": scan.env.codex_marketplace_urls()}


def _install_source(scan: _Scan, install: PluginInstall,
                    urls: dict[str, dict[str, str]]) -> tuple[_MarketplaceClone, str] | None:
    """(clone, plugin name) of install's source: the first marketplace clone
    whose origin names the repo of the install's marketplace URL, when that
    clone lists the install's plugin; None otherwise."""
    plugin, _, marketplace = install.key.partition("@")
    url = urls[install.harness].get(marketplace)
    slug = repo_slug(url) if url is not None else None
    if slug is None:
        return None
    clone = next((clone for clone in scan.marketplace_clones if clone.slug == slug), None)
    if clone is None or plugin not in clone.plugin_folders:
        return None
    return clone, plugin


def _clone_plugin_files(entries: list[Entry], clone: _MarketplaceClone, plugin: str) -> dict[str, str]:
    """_file_key → id of each entry of clone's plugin, keyed below the
    plugin's source folder."""
    folder = clone.plugin_folders[plugin]
    key = f"{plugin}@{clone.name}"
    files = {}
    for entry in entries:
        is_plugin_file = entry.source == "repo" and entry.root == clone.root and entry.plugin == key
        file_key = _file_key(entry, folder) if is_plugin_file else None
        if file_key is not None:
            files[file_key] = entry.id
    return files


def _file_key(entry: Entry, folder: str) -> str | None:
    """entry's real path below folder, "/"-separated, with its id's item
    fragment (#hook:<event>:<n>, #L<line>); None when the path is outside
    folder."""
    path = Path(entry.path)
    if not path.is_relative_to(folder):
        return None
    return path.relative_to(folder).as_posix() + entry.id[len(entry.path):]


def _is_synced_skill_file(env: Environment, entry: Entry) -> bool:
    """Whether any of entry's locations sits under a Claude config folder's
    skills/synced."""
    for location in entry.locations:
        located = env.locate_in_claude_config_dirs(location.path)
        if located is not None and located[1].parts[:len(SYNCED_SKILLS)] == SYNCED_SKILLS:
            return True
    return False


def _plugin_meta(installs: list[PluginInstall]) -> dict:
    first = installs[0]
    meta: dict = {"harness": first.harness, "version": first.version}
    if first.harness == "codex":
        meta["enabled"] = first.enabled
    else:
        pairs = [{"scope": install.scope, "projectPath": str(install.project_path) if install.project_path else None}
                 for install in installs]
        meta["installs"] = [pair for index, pair in enumerate(pairs) if pair not in pairs[:index]]
    return meta


def _walk_repos(scan: _Scan, top: Path) -> None:
    """Every repo at or below top, nested repos and submodules included, each
    recorded in repo_owners; an ignored repo, a linked worktree included
    (see _Scan.is_ignored), drops itself and every folder below it. A file
    is reached by the nearest repo root above it as walked; one with none is skipped. A repo's folder at
    one of the in-repo features home parts, a plain folder below its root, is
    that repo's in-repo feature home, named for the repo; so is a project
    folder's (_features_home_parts),
    named for the project folder. A home's .md files are classified as a
    feature home's are, owned by a features owner registered at its real path
    and recorded in in_repo_feature_homes, except instruction files, which stay
    instructions. Each repo's .claude, .agents and in-repo feature homes are
    measured from that repo's own root, so a repo nested in another's
    .claude is not inside an agent folder of its own: generated folders are
    pruned outside them, and a symlinked folder inside them, or a linked
    .claude or .agents anywhere in a repo, is walked through the link. A
    linked folder on the way to a home is therefore never walked, so never a
    home; a folder on the way holding a .git is a repo of its own, so not a
    home either. Outside any repo, where files are skipped, .claude
    and .agents are measured from top."""
    top = Path(os.path.realpath(top))
    # walked folder → (owner, the repo root as walked), None outside any repo
    repo_of: dict[str, tuple[Owner, str] | None] = {}
    features_owners: dict[str, Owner] = {}  # in-repo feature home as walked → its owner
    plain_homes: dict[str, bool] = {}  # in-repo feature home as walked → whether it is a plain folder

    def walked_root_of(dirpath: str, holds_git: bool) -> str | None:
        """The root, as walked, of the repo dirpath sits in: dirpath itself
        when it holds a .git, else the repo recorded for dirpath or, before
        the loop records it, for its parent; None outside any repo."""
        if holds_git:
            return dirpath
        repo = repo_of[dirpath] if dirpath in repo_of else repo_of.get(os.path.dirname(dirpath))
        return None if repo is None else repo[1]

    def is_in_agent_folder(dirpath: str, walked_root: str) -> bool:
        return any(part in AGENT_FOLDERS for part in Path(dirpath).relative_to(walked_root).parts)

    def features_home_parts(dirpath: str, walked_root: str) -> tuple[str, ...] | None:
        """The parts below walked_root of the plain in-repo feature home
        holding dirpath, None when no such home holds it."""
        home_parts = _features_home_parts(scan.in_repo_parts, walked_root,
                                          Path(dirpath).relative_to(walked_root).parts)
        if home_parts is None:
            return None
        home = os.path.join(walked_root, *home_parts)
        if home not in plain_homes:
            plain_homes[home] = _is_plain_folder(walked_root, home_parts)
        return home_parts if plain_homes[home] else None

    def is_in_features_home(dirpath: str, walked_root: str) -> bool:
        return features_home_parts(dirpath, walked_root) is not None

    def prunes_generated(dirpath: str, holds_git: bool) -> bool:
        walked_root = walked_root_of(dirpath, holds_git)
        if walked_root is None:
            return not is_in_agent_folder(dirpath, str(top))
        return not is_in_agent_folder(dirpath, walked_root) and not is_in_features_home(dirpath, walked_root)

    def follows_link(dirpath: str, name: str) -> bool:
        repo = repo_of.get(dirpath)
        if repo is None:
            return False
        walked_root = repo[1]
        return (name in AGENT_FOLDERS or is_in_agent_folder(dirpath, walked_root)
                or is_in_features_home(dirpath, walked_root))

    walk = scan.walk(top, prunes_generated=prunes_generated, follows_link=follows_link)
    for dirpath, dirnames, filenames, is_linked, holds_git in walk:
        repo = repo_of.get(os.path.dirname(dirpath))
        if holds_git and not is_linked:
            real_root = os.path.realpath(dirpath)
            if scan.is_ignored(real_root):
                dirnames[:] = []
                continue
            owner = scan.repo_owner(real_root)
            scan.repo_owners[real_root] = owner
            repo = (owner, dirpath)
        repo_of[dirpath] = repo
        if repo is None:
            continue
        owner, walked_root = repo
        rel_dir = Path(dirpath).relative_to(walked_root).parts
        home_parts = features_home_parts(dirpath, walked_root)
        if home_parts is None:
            for name in sorted(filenames):
                _add_repo_file(scan, Path(dirpath) / name, rel_dir, owner)
            continue
        home = os.path.join(walked_root, *home_parts)
        if home not in features_owners:
            features_owners[home] = _register_in_repo_features_home(scan, owner, home, home_parts)
        for name in sorted(filenames):
            if name in INSTRUCTION_NAMES:
                _add_repo_file(scan, Path(dirpath) / name, rel_dir, owner)
            elif name.endswith(".md"):
                scan.add_feature_file(Path(dirpath) / name, rel_dir[len(home_parts):], features_owners[home])


def _features_home_parts(in_repo_parts: tuple[tuple[str, ...], ...], walked_root: str,
                         rel_dir: tuple[str, ...]) -> tuple[str, ...] | None:
    """The parts below walked_root of the in-repo feature home rel_dir sits
    in, links not yet checked, trying each of in_repo_parts in order: the
    repo's own folder at those parts, or a project folder's — a folder
    directly under the root holding an AGENTS.md, as each folder of a repo
    that gathers several projects does; None for any other folder."""
    for parts in in_repo_parts:
        if rel_dir[:len(parts)] == parts:
            return parts
        if rel_dir[1:1 + len(parts)] != parts:
            continue
        if os.path.isfile(os.path.join(walked_root, rel_dir[0], PROJECT_INSTRUCTIONS)):
            return rel_dir[:1 + len(parts)]
    return None


def _is_plain_folder(walked_root: str, rel_parts: tuple[str, ...]) -> bool:
    """Whether the folder at rel_parts below walked_root is reached with no
    link on the way: its real path is the real walked_root's own."""
    folder = Path(walked_root).joinpath(*rel_parts)
    return os.path.realpath(folder) == os.path.join(os.path.realpath(walked_root), *rel_parts)


def _register_in_repo_features_home(scan: _Scan, repo_owner: Owner, home: str,
                                    home_parts: tuple[str, ...]) -> Owner:
    """The features owner of the in-repo feature home at home, registered as
    an owner root at its real path and recorded in in_repo_feature_homes
    against repo_owner's root: named for repo_owner's repo when it is the
    repo's own home, else for its project folder."""
    real_folder = os.path.realpath(home)
    is_project_home = home_parts not in scan.in_repo_parts
    owner = Owner("features", repo=home_parts[0] if is_project_home else repo_owner.repo, root=real_folder)
    scan.owner_roots[real_folder] = owner
    scan.in_repo_feature_homes[real_folder] = repo_owner.root
    return owner


def _is_linked_worktree(real_root: str) -> bool:
    """Whether real_root's .git is a file whose gitdir names a linked
    worktree's git folder, which holds a commondir file; a submodule's git
    folder holds none."""
    git_file = os.path.join(real_root, GIT_FOLDER)
    if not os.path.isfile(git_file):
        return False
    first_line = _read(git_file).partition("\n")[0]
    if not first_line.startswith(GITDIR_PREFIX):
        return False
    git_folder = os.path.join(real_root, first_line[len(GITDIR_PREFIX):].strip())
    return os.path.isfile(os.path.join(git_folder, WORKTREE_COMMONDIR_FILE))


def _holds_git(dirpath: str, dirnames: list[str], filenames: list[str]) -> bool:
    """Whether dirpath, which os.walk listed as dirnames and filenames, is a
    repo root by is_repo_root: a .git folder settles it from the listing, and
    only a .git in filenames, which a dangling link also is, costs a check."""
    return GIT_FOLDER in dirnames or (GIT_FOLDER in filenames and is_repo_root(Path(dirpath)))


def _add_repo_file(scan: _Scan, path: Path, rel_dir: tuple[str, ...], owner: Owner) -> None:
    kind = _repo_file_kind(rel_dir, path.name)
    if kind == "hook":
        scan.add_hooks(path, owner)
    elif kind == "followup":
        scan.add_repo_followup(path, owner)
    elif kind is not None:
        scan.add_doc(kind, path, owner)


def _repo_file_kind(rel_dir: tuple[str, ...], name: str) -> str | None:
    """The kind of a repo file from its folder's parts below the repo root;
    "hook" for a settings file, None for a file the index skips."""
    if name in INSTRUCTION_NAMES:
        return "instructions"
    is_markdown = name.endswith(".md")
    if rel_dir == ("docs", "followups"):
        return "followup" if is_markdown and name != "README.md" else None
    if rel_dir[-3:-1] == (".agents", "skills") and name == "SKILL.md":
        return "skill"
    if ".claude" not in rel_dir:
        return None
    below_claude = rel_dir[len(rel_dir) - rel_dir[::-1].index(".claude"):]
    if not below_claude:
        if name in SETTINGS_FILES:
            return "hook"
        return "annotation" if fnmatch.fnmatch(name, ANNOTATION_FILE) else None
    if below_claude[0] == "skills" and len(below_claude) == 2 and name == "SKILL.md":
        return "skill"
    if not is_markdown:
        return None
    if below_claude[0] == "rules":
        return "rule"
    if below_claude[0] == "commands":
        return "command"
    if below_claude == ("agents",):
        return "subagent"
    return None


def _walk_feature_home(scan: _Scan, folder: Path) -> None:
    """The feature home's .md files, walked from its real path as the other
    walks are, the home registered as an owner root."""
    real_folder = Path(os.path.realpath(folder))
    owner = Owner("features", repo=folder.name, root=str(real_folder))
    scan.owner_roots[owner.root] = owner
    for dirpath, _, filenames, _, _ in scan.walk(real_folder):
        rel_dir = Path(dirpath).relative_to(real_folder).parts
        for name in sorted(filenames):
            if name.endswith(".md"):
                scan.add_feature_file(Path(dirpath) / name, rel_dir, owner)


def _feature_file_kind(features: FeaturesHomes, rel_dir: tuple[str, ...], name: str) -> str:
    """The kind of a .md file in a feature home, from its folder's parts below
    the home: the follow-ups file and the area folder's files are follow-ups."""
    if rel_dir == () and name == features.file:
        return "followup"
    if features.area_folder is not None and rel_dir == (features.area_folder,):
        return "feature-doc" if name == "README.md" else "followup"
    in_feature = len(rel_dir) == 1
    in_plan = len(rel_dir) == 2 and rel_dir[1].startswith("plan-")
    if in_feature and name == "checklist.md":
        return "feature"
    if in_plan and name == "plan.md":
        return "plan"
    if (in_feature or in_plan) and TASK_FILE.match(name):
        return "task"
    return "feature-doc"


def _add_ancestor_instructions(scan: _Scan, folders: list[Path]) -> None:
    """Instruction files in each folder and its ancestors outside every owner
    root, as global entries; an ignored repo's are left out."""
    for folder in folders:
        real = Path(os.path.realpath(folder))
        for ancestor in (real, *real.parents):
            if scan.root_owner(str(ancestor)) is not None or scan.is_in_ignored_repo(ancestor):
                continue
            for name in ANCESTOR_INSTRUCTION_FILES:
                scan.add_doc("instructions", ancestor / name, GLOBAL)


def _resolve_imports(scan: _Scan) -> None:
    """Set each instruction entry's meta["imports"], adding an instructions
    entry for each imported file no walk found and no ignored repo holds, up
    to IMPORT_HOPS from the file that started the chain, claimed with no walk
    owner so it is owned by its real path alone (global in no owner root).
    Breadth-first, so a file reached by two chains takes its
    shortest hop count."""
    pending = deque((entry.id, 0) for entry in list(scan.entries.values()) if entry.kind == "instructions")
    while pending:
        entry_id, hops = pending.popleft()
        entry = scan.entries[entry_id]
        targets = _import_targets(scan.env.home, entry.path)
        scan.entries[entry_id] = replace(entry, meta={**entry.meta, "imports": targets})
        if hops == IMPORT_HOPS:
            continue
        for target in targets:
            if scan.is_in_ignored_repo(Path(target).parent):
                continue
            added = scan.add_doc("instructions", Path(target), None)
            if added is not None:
                pending.append((added.id, hops + 1))


def _import_targets(home: Path, real_path: str) -> list[str]:
    """The real paths of the existing files the @imports in real_path name:
    "~" against home, any other path against the file's folder."""
    folder = os.path.dirname(real_path)
    targets: list[str] = []
    for raw in imports(_read(real_path)):
        target = os.path.realpath(os.path.join(folder, expand_home(raw, home)))
        if os.path.isfile(target) and target not in targets:
            targets.append(target)
    return targets


def _markdown_below(scan: _Scan, folder: Path) -> Iterator[Path]:
    """Every .md file in folder and its subfolders, linked folders one level
    deep included, in sorted order, less the folders every walk prunes or
    skips; nothing when folder is absent."""
    for dirpath, _, filenames, _, _ in scan.walk(folder):
        for name in sorted(filenames):
            if name.endswith(".md"):
                yield Path(dirpath) / name


def _event_hooks(groups: object) -> Iterator[tuple[str | None, dict]]:
    """(matcher, hook) for each hook of one event's matcher groups, in order;
    matcher is None when the group has none or an empty one."""
    if not isinstance(groups, list):
        return
    for group in groups:
        if not isinstance(group, dict) or not isinstance(group.get("hooks"), list):
            continue
        matcher = group.get("matcher") or None
        for hook in group["hooks"]:
            if isinstance(hook, dict):
                yield matcher, hook


def _hook_entry(owner: Owner, real: str, event: str, number: int, matcher: str | None, hook: dict) -> Entry:
    command = hook.get("command") or None
    program = _program_name(command) if command else str(hook.get("type", ""))
    title = f"{event} {matcher} → {program}" if matcher else f"{event} → {program}"
    meta = {"event": event, "matcher": matcher, "command": command}
    return _entry(owner, "hook", real, title, meta, suffix=f"#hook:{event}:{number}")


def _program_name(command: str) -> str:
    """The base name of a shell command's first word."""
    words = command.split()
    return os.path.basename(words[0].strip("'\"")) if words else ""


def _entry(owner: Owner, kind: str, path: str, title: str, meta: dict,
           line: int | None = None, suffix: str | None = None) -> Entry:
    """An entry for path; an item at a line gets the id suffix #L<line>."""
    if suffix is None:
        suffix = f"#L{line}" if line is not None else ""
    return Entry(
        id=path + suffix,
        kind=kind,
        source=owner.source,
        repo=owner.repo,
        root=owner.root,
        plugin=owner.plugin,
        path=path,
        line=line,
        title=title,
        meta=meta,
    )


def _title(kind: str, path: Path, text: str) -> str:
    if kind == "skill":
        return str(front_matter(text).get("name") or path.parent.name)
    if kind == "subagent":
        return str(front_matter(text).get("name") or path.stem)
    return heading_title(text) or path.name


def _doc_meta(kind: str, path: Path, text: str) -> dict:
    """meta for a whole-file entry; path is the file as walked, so a skill's
    agents/openai.yaml is found beside it."""
    if kind == "skill":
        fields = front_matter(text)
        return {
            "name": fields.get("name"),
            "description": fields.get("description"),
            "userInvokedOnly": fields.get("disable-model-invocation") is True,
            "implicitInvocation": not _implicit_invocation_off(path.parent / "agents" / "openai.yaml"),
        }
    if kind == "subagent":
        fields = front_matter(text)
        return {"name": fields.get("name"), "description": fields.get("description"), "model": fields.get("model")}
    if kind == "rule":
        paths = front_matter(text).get("paths")
        return {"paths": [paths] if isinstance(paths, str) else list(paths or [])}
    if kind == "instructions":
        return {"imports": []}
    return {}


def _implicit_invocation_off(openai_yaml: Path) -> bool:
    return openai_yaml.is_file() and IMPLICIT_INVOCATION_OFF.search(_read(str(openai_yaml))) is not None


def _read(path: str) -> str:
    return read_exact_text(Path(path), errors="replace")


def _holds_nul(path: Path) -> bool:
    """Whether path's first BINARY_SNIFF_BYTES hold a NUL byte."""
    with open(path, "rb") as file:
        return b"\x00" in file.read(BINARY_SNIFF_BYTES)
