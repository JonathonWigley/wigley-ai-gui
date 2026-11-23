"""Claude Code's load rules: which discovered entries a Claude Code session
opened in a folder loads, and when.

Every entry gets a state from the rule for its kind, judged at each of its
locations (its real path, each path a symlink reached it by, and each
plugin install's copy of a marketplace clone's file), each by that
location's own owner — plugin membership and enablement included — and
the best kept, then a last pass follows @imports from the files that load, four hops
deep. A skill-file is not-loaded at every location, since agents read it on
a pointer, unless an @import reaches it. Plugin enablement, settings files and the AGENTS.md mode come from
Environment; the AGENTS.md shadowing check reads the filesystem, since a
CLAUDE.md switches AGENTS.md off whether or not it was indexed. User-level
files are those of the judged Claude config folder, the first of
Environment.claude_config_dirs; a file in another Claude config folder, home's
.claude counting as one whether or not it is configured, is not-loaded, and a
plugin's files are judged as the plugin's wherever its
cache sits.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from config import home_relative
from environment import Environment
from model import IMPORT_HOPS, LOAD_STATES, Entry, Location, Owner, State, best_state
from rules import nearest_repo_root

NO_RULE = "no load rule reaches this file"
CODEX_FILE = "Codex file"
OUTSIDE = "outside the folder's ancestors and subtree"
SKILL_FILE_REASON = "agents read skill files on a pointer"

POINTER_KINDS = ("feature", "task", "plan", "feature-doc", "followup", "reference", "learning", "annotation")
CLAUDE_MD_NAMES = ("CLAUDE.md", "CLAUDE.local.md")
AGENTS_MD_NAME = "AGENTS.md"
APPLYING_PROJECT_SCOPES = ("project", "local")


class ClaudeRules:
    harness = "claude"

    def __init__(self, env: Environment):
        self._env = env

    def states(self, folder: Path, entries: list[Entry]) -> dict[str, State]:
        folder = folder.resolve()
        home = self._env.home.resolve()
        repo_root = nearest_repo_root(folder)
        scope = _Scope(
            folder=folder,
            home=home,
            written_home=self._env.home,
            config_dir=self._env.claude_config_dirs[0],
            locate_config_file=self._env.locate_in_claude_config_dirs,
            ancestors=[folder, *folder.parents],
            ancestors_to_repo=_ancestors_to(folder, repo_root),
            mode=self._env.instruction_files_mode(),
            shadowing_file=_first_claude_md_above(folder, self._env.locate_in_claude_config_dirs),
            settings_files={path.resolve() for path in self._env.claude_settings_files(repo_root)},
            enabled_plugin_roots=self._enabled_plugin_roots(repo_root),
            codex_plugin_roots={entry.root for entry in entries
                                if entry.kind == "plugin" and entry.meta.get("harness") == "codex"},
        )
        states = {entry.id: _entry_state(entry, scope) for entry in entries}
        _apply_imports(entries, states)
        return states

    def _enabled_plugin_roots(self, repo_root: Path | None) -> set[Path]:
        """Install folders of Claude plugins enabled for a session in repo_root."""
        enabled_keys = self._env.enabled_claude_plugins(repo_root)
        roots = set()
        for install in self._env.claude_plugin_installs(self._env.claude_config_dirs[0]):
            applies_to_user = install.scope == "user"
            applies_to_repo = (install.scope in APPLYING_PROJECT_SCOPES and repo_root is not None
                               and install.project_path is not None
                               and install.project_path.resolve() == repo_root)
            if install.key in enabled_keys and (applies_to_user or applies_to_repo):
                roots.add(install.install_path.resolve())
        return roots


@dataclass(frozen=True)
class _Scope:
    """Everything about the folder the per-entry rules read, computed once per states call."""

    folder: Path
    home: Path
    written_home: Path  # the unresolved home, which home_relative writes as "~"
    config_dir: Path  # the judged Claude config folder
    locate_config_file: Callable[[Path], tuple[Path, Path] | None]
    ancestors: list[Path]
    ancestors_to_repo: list[Path]
    mode: str
    shadowing_file: Path | None
    settings_files: set[Path]
    enabled_plugin_roots: set[Path]
    codex_plugin_roots: set[str | None]

    def is_below(self, owner: Path) -> bool:
        return owner != self.folder and owner.is_relative_to(self.folder)


def _ancestors_to(folder: Path, repo_root: Path | None) -> list[Path]:
    """folder and each parent through repo_root; folder alone outside a repo."""
    if repo_root is None:
        return [folder]
    chain = []
    for candidate in (folder, *folder.parents):
        chain.append(candidate)
        if candidate == repo_root:
            break
    return chain


def _first_claude_md_above(folder: Path,
                           locate_config_file: Callable[[Path], tuple[Path, Path] | None]) -> Path | None:
    """The first project CLAUDE.md, .claude/CLAUDE.md or CLAUDE.local.md walking
    up from folder; a file in a Claude config folder, home's .claude always
    among them, is a user file, judged or not, never a project one."""
    for candidate in (folder, *folder.parents):
        for path in (candidate / "CLAUDE.md", candidate / ".claude" / "CLAUDE.md", candidate / "CLAUDE.local.md"):
            if path.is_file() and locate_config_file(path) is None:
                return path
    return None


def _entry_state(entry: Entry, scope: _Scope) -> State:
    if entry.kind == "skill-file":
        return State("not-loaded", SKILL_FILE_REASON)
    return best_state(_location_state(entry, location, scope) for location in entry.locations)


def _location_state(entry: Entry, location: Location, scope: _Scope) -> State:
    """The state of entry judged at one of its locations, by that location's
    path and owner."""
    path = Path(location.path)
    owner = location.owner
    is_plugin_location = owner.source == "plugin"
    is_codex_plugin_location = is_plugin_location and owner.root in scope.codex_plugin_roots
    if entry.kind == "prompt" or is_codex_plugin_location or path.is_relative_to(scope.home / ".codex"):
        return State("not-loaded", CODEX_FILE)
    if entry.kind in POINTER_KINDS:
        return State("not-loaded", f"agents read {entry.kind} files on a pointer")
    if is_plugin_location:
        return _plugin_file_state(entry, owner, scope)
    located = scope.locate_config_file(path)
    if located is not None:
        config_state = _config_dir_file_state(entry, path, *located, scope)
        if config_state is not None:
            return config_state
    if entry.kind == "instructions":
        return _instructions_state(path, scope)
    if entry.kind == "rule":
        return _rule_state(entry, path, scope)
    if entry.kind == "skill":
        return _skill_state(entry, path, scope)
    if entry.kind in ("subagent", "command"):
        return _listed_in_claude_folder_state(path, "agents" if entry.kind == "subagent" else "commands", scope)
    if entry.kind == "hook":
        if path.resolve() in scope.settings_files:
            return State("launch", f"hook in settings file {path}")
        return State("not-loaded", "hook in a settings file this folder does not read")
    return State("not-loaded", NO_RULE)


def _plugin_file_state(entry: Entry, plugin: Owner, scope: _Scope) -> State:
    """A Claude plugin's own entry or one of its components, at a location
    the plugin owns."""
    enabled = plugin.root is not None and Path(plugin.root).resolve() in scope.enabled_plugin_roots
    if entry.kind == "plugin":
        return State("launch", "enabled in settings") if enabled else State("not-loaded", "not enabled for this folder")
    if entry.kind == "instructions":
        return State("not-loaded", "instruction files inside a plugin are not loaded")
    if not enabled:
        return State("not-loaded", f"plugin {plugin.plugin} not enabled for this folder")
    if entry.kind == "hook":
        return State("launch", f"hook of enabled plugin {plugin.plugin}")
    if entry.kind == "skill" and entry.meta.get("userInvokedOnly"):
        return State("on-demand", f"skill of enabled plugin {plugin.plugin} with disable-model-invocation")
    if entry.kind in ("skill", "subagent", "command"):
        return State("listed", f"{entry.kind} of enabled plugin {plugin.plugin}")
    return State("not-loaded", NO_RULE)


def _config_dir_file_state(entry: Entry, path: Path, config_dir: Path, relative: Path,
                           scope: _Scope) -> State | None:
    """The state of a file in a configured Claude config folder: not-loaded in
    a folder other than the judged one, a user file in the judged one, and
    None for a judged-folder file no user rule names (a hook, a file only an
    @import reaches), which the kind rules judge."""
    judged = home_relative(scope.config_dir, scope.written_home)
    if config_dir != scope.config_dir:
        where = home_relative(config_dir, scope.written_home)
        return State("not-loaded", f"in Claude config folder {where}; states are judged against {judged}")
    top = relative.parts[0] if relative.parts else None
    if entry.kind == "instructions" and relative == Path("CLAUDE.md"):
        return State("launch", f"user instructions file {judged}/CLAUDE.md")
    if entry.kind == "rule" and top == "rules":
        if entry.meta.get("paths"):
            return State("on-demand", f"rule in {judged}/rules scoped by paths:")
        return State("launch", f"rule in {judged}/rules without paths:")
    if entry.kind == "skill" and top == "skills":
        if entry.meta.get("userInvokedOnly"):
            return State("on-demand", f"user skill in {path.parent}, with disable-model-invocation")
        return State("listed", f"user skill in {path.parent}")
    if entry.kind == "subagent" and top == "agents":
        return State("listed", f"user file in {judged}/agents")
    if entry.kind == "command" and top == "commands":
        return State("listed", f"user file in {judged}/commands")
    return None


def _instructions_state(path: Path, scope: _Scope) -> State:
    is_in_dot_claude = path.parent.name == ".claude"
    owner = path.parent.parent if is_in_dot_claude else path.parent
    is_claude_md = path.name == "CLAUDE.md" or (path.name == "CLAUDE.local.md" and not is_in_dot_claude)
    if is_claude_md:
        return _claude_md_state(owner, scope)
    if path.name == AGENTS_MD_NAME:
        return _agents_md_state(owner, scope)
    return State("not-loaded", NO_RULE)


def _claude_md_state(owner: Path, scope: _Scope) -> State:
    if owner in scope.ancestors:
        return State("launch", f"CLAUDE file in {owner}, an ancestor of the folder")
    if scope.is_below(owner):
        return State("on-demand", f"CLAUDE file in {owner}, below the folder")
    return State("not-loaded", OUTSIDE)


def _agents_md_state(owner: Path, scope: _Scope) -> State:
    if scope.mode in ("claude-md", "managed-only"):
        return State("not-loaded", f"instructionFiles is {scope.mode}")
    is_ancestor = owner in scope.ancestors
    if not is_ancestor and not scope.is_below(owner):
        return State("not-loaded", OUTSIDE)
    reads_both = scope.mode == "claude-md-and-agents-md"
    if not reads_both and scope.shadowing_file is not None:
        return State("shadowed", f"shadowed by {scope.shadowing_file}")
    if is_ancestor:
        return State("launch", f"AGENTS.md in {owner}, an ancestor of the folder; no CLAUDE.md above it")
    own_claude_md = _first_claude_md_in(owner)
    if not reads_both and own_claude_md is not None:
        return State("shadowed", f"shadowed by {own_claude_md}")
    return State("on-demand", f"AGENTS.md in {owner}, below the folder")


def _first_claude_md_in(owner: Path) -> Path | None:
    for path in (owner / "CLAUDE.md", owner / ".claude" / "CLAUDE.md", owner / "CLAUDE.local.md"):
        if path.is_file():
            return path
    return None


def _owner_of_claude_folder(path: Path, subfolder: str, dot_folder: str = ".claude") -> Path | None:
    """The folder holding the <dot_folder>/<subfolder> that path sits under, or None."""
    for parent in path.parents:
        if parent.name == subfolder and parent.parent.name == dot_folder:
            return parent.parent.parent
    return None


def _rule_state(entry: Entry, path: Path, scope: _Scope) -> State:
    owner = _owner_of_claude_folder(path, "rules")
    if owner is None or owner not in scope.ancestors:
        return State("not-loaded", "rule outside the .claude/rules of the folder's ancestors")
    where = f"{owner}/.claude/rules"
    if entry.meta.get("paths"):
        return State("on-demand", f"rule in {where} scoped by paths:")
    return State("launch", f"rule in {where} without paths:")


def _skill_state(entry: Entry, path: Path, scope: _Scope) -> State:
    owner = _owner_of_claude_folder(path, "skills")
    if owner is None:
        if _owner_of_claude_folder(path, "skills", dot_folder=".agents") is not None:
            return State("not-loaded", ".agents/skills with no .claude/skills linking to it")
        return State("not-loaded", NO_RULE)
    if owner in scope.ancestors_to_repo:
        state = State("listed", f"skill in {path.parent}")
    elif scope.is_below(owner):
        return State("on-demand", f"skill in {path.parent}, below the folder")
    else:
        return State("not-loaded", NO_RULE)
    if entry.meta.get("userInvokedOnly"):
        return State("on-demand", f"{state.reason}, with disable-model-invocation")
    return state


def _listed_in_claude_folder_state(path: Path, subfolder: str, scope: _Scope) -> State:
    owner = _owner_of_claude_folder(path, subfolder)
    if owner is not None and owner in scope.ancestors_to_repo:
        return State("listed", f"in {owner}/.claude/{subfolder}")
    return State("not-loaded", NO_RULE)


def _apply_imports(entries: list[Entry], states: dict[str, State]) -> None:
    """Raise each file an @import reaches to its importer's state, four hops
    deep, best state first so a file reached twice keeps the better one."""
    whole_files = {entry.path: entry for entry in entries if entry.id == entry.path}
    initial = dict(states)
    for spreading in ("launch", "on-demand", "shadowed"):
        rank = LOAD_STATES.index(spreading)
        pending = deque((entry, 0) for entry in entries if initial[entry.id].state == spreading)
        seen = {entry.id for entry, _ in pending}
        while pending:
            importer, hops = pending.popleft()
            if hops == IMPORT_HOPS:
                continue
            for imported_path in importer.meta.get("imports", []):
                imported = whole_files.get(str(Path(imported_path).resolve()))
                if imported is None or imported.id in seen:
                    continue
                seen.add(imported.id)
                if LOAD_STATES.index(states[imported.id].state) > rank:
                    states[imported.id] = State(spreading, f"imported by {importer.path}")
                pending.append((imported, hops + 1))
