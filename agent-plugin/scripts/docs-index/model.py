"""The index document's records: one Entry per indexed doc or item, one State
per entry and harness, and one Context per folder or session whose states
were computed. to_json emits the README's schema, so the wigley-ai-gui docs
browser reads the output as is; a change to that shape bumps SCHEMA_VERSION.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable

SCHEMA_VERSION = 5
KINDS = ("instructions", "reference", "learning", "rule", "skill", "skill-file", "subagent", "command", "prompt",
         "hook", "plugin", "annotation", "feature", "task", "plan", "feature-doc", "followup")
SOURCES = ("global", "repo", "plugin", "features")
OWNERS = ("mine", "third-party")
LINK_FORMS = ("markdown", "section")
UNLOADED_KINDS = ("hook", "plugin")  # config entries no transcript row loads
LOAD_STATES = ("launch", "on-demand", "listed", "shadowed", "not-loaded")
HARNESSES = ("claude", "codex")
IMPORT_HOPS = 4  # how far an @import chain is followed from the file that starts it


@dataclass(frozen=True)
class Owner:
    """The source fields an entry belongs to: who owns the file, or the walk
    that reached it."""

    source: str
    repo: str | None = None
    root: str | None = None
    plugin: str | None = None


@dataclass(frozen=True)
class Location:
    """One path an entry's file is reached by, with the owner the load rules
    and reach judge that path by: the entry's owner at its real path, the
    owner of the walk that reached it at a linked path."""

    path: str
    owner: Owner


@dataclass(frozen=True)
class Installed:
    """One plugin install's copy of a marketplace clone's file: location is the
    copy's real path with the install's plugin Owner."""

    location: Location
    harness: str
    version: str

    def __post_init__(self) -> None:
        if self.harness not in HARNESSES:
            raise ValueError(f"installed {self.location.path!r}: harness {self.harness!r} is not one of {HARNESSES}")


@dataclass(frozen=True)
class DocHeading:
    """One heading of an entry's file. line is 1-based; text has its closing
    hashes, backticks and * removed."""

    level: int
    text: str
    line: int

    def to_json(self) -> dict:
        return {"level": self.level, "text": self.text, "line": self.line}


@dataclass(frozen=True)
class DocLink:
    """One outgoing reference of an entry's file. raw is its source text, each
    line break read as a line feed, target the real path of the target file,
    line its 1-based source line, and target_line the target heading's 1-based
    line, or None when the link names a file only."""

    form: str
    raw: str
    target: str
    line: int
    target_line: int | None

    def __post_init__(self) -> None:
        if self.form not in LINK_FORMS:
            raise ValueError(f"link {self.raw!r}: form {self.form!r} is not one of {LINK_FORMS}")

    def to_json(self) -> dict:
        return {"form": self.form, "raw": self.raw, "target": self.target, "line": self.line,
                "targetLine": self.target_line}


@dataclass(frozen=True)
class Entry:
    """One indexed doc, or one item inside a doc. id is the real path, with
    #L<line> for an item and #hook:<event>:<n> for a hook. source, repo, root
    and plugin name the owner of the real path. walked holds each other path a
    walk reached the file by, through a symlink, paired with the owner of the
    walk that reached it so; the load rules judge every location by its own
    owner, the entry reaches a context when any location's owner does, and
    to_json exports the walked paths, not their owners. ownership is the JSON
    owner, mine or third-party. installed holds each plugin install's copy of
    a marketplace clone's file, exported in meta.installed and kept out of
    walked: the docs browser trashes each walked link with the file, and must
    never trash an install's copy. last_loaded is the latest transcript time
    that loaded the entry, or None. headings and links are read from the
    entry's file by doc_fields.py; both stay empty for an entry with no body."""

    id: str
    kind: str
    source: str
    repo: str | None
    root: str | None
    plugin: str | None
    path: str
    line: int | None
    title: str
    meta: dict
    walked: tuple[Location, ...] = ()
    ownership: str = "mine"
    installed: tuple[Installed, ...] = ()
    last_loaded: str | None = None
    headings: tuple[DocHeading, ...] = ()
    links: tuple[DocLink, ...] = ()

    @property
    def owner(self) -> Owner:
        return Owner(self.source, self.repo, self.root, self.plugin)

    @property
    def locations(self) -> tuple[Location, ...]:
        """The real path with the entry's owner, then each walked location,
        then each installed copy's location."""
        return (Location(self.path, self.owner), *self.walked,
                *(installed.location for installed in self.installed))

    def __post_init__(self) -> None:
        if self.kind not in KINDS:
            raise ValueError(f"entry {self.id!r}: kind {self.kind!r} is not one of {KINDS}")
        if self.source not in SOURCES:
            raise ValueError(f"entry {self.id!r}: source {self.source!r} is not one of {SOURCES}")
        if self.ownership not in OWNERS:
            raise ValueError(f"entry {self.id!r}: owner {self.ownership!r} is not one of {OWNERS}")

    def to_json(self) -> dict:
        return {
            "id": self.id,
            "kind": self.kind,
            "source": self.source,
            "owner": self.ownership,
            "repo": self.repo,
            "root": self.root,
            "plugin": self.plugin,
            "path": self.path,
            "line": self.line,
            "title": self.title,
            "meta": self._meta_json(),
            "walked": [location.path for location in self.walked],
            "lastLoaded": self.last_loaded,
            "headings": [heading.to_json() for heading in self.headings],
            "links": [link.to_json() for link in self.links],
        }

    def _meta_json(self) -> dict:
        """meta, plus installed for a marketplace clone's plugin file."""
        is_clone_plugin_file = self.source == "repo" and self.plugin is not None
        if not is_clone_plugin_file:
            return self.meta
        installed = [{"harness": i.harness, "version": i.version, "path": i.location.path} for i in self.installed]
        return {**self.meta, "installed": installed}


@dataclass(frozen=True)
class State:
    """Whether one harness loads one entry, and the rule that says so."""

    state: str
    reason: str

    def __post_init__(self) -> None:
        if self.state not in LOAD_STATES:
            raise ValueError(f"load state {self.state!r} is not one of {LOAD_STATES}")

    def to_json(self) -> dict:
        return {"state": self.state, "reason": self.reason}


def best_state(states: Iterable[State]) -> State:
    """The state that loads soonest, in LOAD_STATES order; the first of equals."""
    return min(states, key=lambda state: LOAD_STATES.index(state.state))


@dataclass
class Context:
    """The load states for one folder, or for one Claude Code session when
    session_id is set. states maps entry id to harness to State.
    loaded_plugins maps <plugin>@<marketplace> to the version a session
    loaded; empty outside a session."""

    folder: str
    session_id: str | None
    states: dict[str, dict[str, State]]
    loaded_plugins: dict[str, str] = field(default_factory=dict)

    def to_json(self) -> dict:
        return {
            "folder": self.folder,
            "sessionId": self.session_id,
            "loadedPlugins": dict(self.loaded_plugins),
            "states": {
                entry_id: {harness: state.to_json() for harness, state in by_harness.items()}
                for entry_id, by_harness in self.states.items()
            },
        }


def document(entries: list[Entry], contexts: list[Context], generated_at: str) -> dict:
    """The whole index document. Entries and contexts are sorted so two builds
    of the same tree serialize identically."""
    sorted_entries = sorted(entries, key=lambda entry: entry.id)
    sorted_contexts = sorted(contexts, key=lambda context: (context.folder, context.session_id or ""))
    return {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": generated_at,
        "entries": [entry.to_json() for entry in sorted_entries],
        "contexts": [context.to_json() for context in sorted_contexts],
    }
