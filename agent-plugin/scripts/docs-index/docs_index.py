"""The docs index's command line: build writes ~/.agents/wigley-docs/index.json,
context prints the index document for one folder, session the one for one
Claude Code session, and loads-check the files a session's folder is
predicted to load at launch that its instructions loads left out. build and
context also read every Claude Code transcript for each entry's last-loaded
time and write the loads cache; session reads its own transcripts' times
alone. Those three read each entry's headings and links from its file.

The composition root: the only module that builds an Environment over the real
home and clock. Every other module takes the Environment it is handed, so a
test passes main a temp home and a fixed clock. Each command reads the config
and hands on the Environment with its Claude config folders: build and
context judge Claude Code against the first, session and loads-check against
the folder that holds the transcript. The --contributions file, read once before the
command, gives the walks their global folders and features homes and the
links their skill link prefixes; with none, the index has neither.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

from atomic_write import write_through_temp
from claude_rules import ClaudeRules
from codex_rules import CodexRules
from config import Config, expand_home, load_config
from contributions import Contributions, load_contributions
from discover import Discovery, discover, discover_folder
from doc_fields import with_doc_fields
from environment import Environment
from loads import LoadTimes, last_loaded, machine_load_times, session_load_times
from loads_check import check_points, missing_loads
from model import Context, Entry, Owner, State, document
from rules import LoadRules, repo_roots_holding
from session import SessionNotFound, read_session, session_context

INDEX_PATH_PARTS = (".agents", "wigley-docs", "index.json")
GENERATED_AT_FORMAT = "%Y-%m-%dT%H:%M:%SZ"
SHARED_SOURCES = ("global", "plugin")


def build_context(env: Environment, folder: Path, discovery: Discovery, rules: list[LoadRules]) -> Context:
    """The Context for a session opened in folder: the discovered entries
    reaching it (see _reaching_entries), each with one State per rule set."""
    real_folder = Path(os.path.realpath(folder))
    reaching = _reaching_entries(env, real_folder, discovery)
    states: dict[str, dict[str, State]] = {entry.id: {} for entry in reaching}
    for rule_set in rules:
        for entry_id, state in rule_set.states(real_folder, reaching).items():
            states[entry_id][rule_set.harness] = state
    return Context(folder=str(real_folder), session_id=None, states=states)


def main(argv: list[str] | None = None, env: Environment | None = None) -> int:
    if env is None:
        env = Environment(home=Path.home(), now=lambda: datetime.now(timezone.utc))
    args = _parser().parse_args(argv)
    contributions_path = None if args.contributions is None else Path(expand_home(args.contributions, env.home))
    contributions = load_contributions(contributions_path, env.home)
    if args.command == "build":
        return _build(env, contributions, args.stdout)
    if args.command == "context":
        return _context(env, contributions, args.dir)
    if args.command == "loads-check":
        return _loads_check(env, contributions, args.id)
    return _session(env, contributions, args.id)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="docs_index.py", description="Index the agent docs on this machine.")
    parser.add_argument("--contributions", metavar="FILE",
                        help="the contributions file the app writes: global folders, link prefixes, features homes")
    commands = parser.add_subparsers(dest="command", required=True)
    build = commands.add_parser("build", help="write ~/.agents/wigley-docs/index.json")
    build.add_argument("--stdout", action="store_true", help="also print the index document")
    context = commands.add_parser("context", help="print the index document for one folder")
    context.add_argument("dir")
    session = commands.add_parser("session", help="print the index document for one Claude Code session")
    session.add_argument("id")
    loads_check = commands.add_parser(
        "loads-check", help="print each launch file a Claude Code session's instructions loads left out")
    loads_check.add_argument("id")
    return parser


def _configured(env: Environment) -> tuple[Environment, Config]:
    """The config, and env carrying its Claude config folders."""
    config = load_config(env)
    return replace(env, claude_config_dirs=config.claude_config_dirs), config


def _build(env: Environment, contributions: Contributions, to_stdout: bool) -> int:
    env, config = _configured(env)
    discovery = discover(env, config, contributions)
    times = machine_load_times(env)
    rules = _all_rules(env)
    contexts = [build_context(env, folder, discovery, rules) for folder in discovery.context_folders]
    entries = _finished_entries(env, contributions, discovery.entries, times)
    text = _serialize(document(entries, contexts, _generated_at(env)))
    _write_index(env.home.joinpath(*INDEX_PATH_PARTS), text)
    if to_stdout:
        print(text)
    return 0


def _context(env: Environment, contributions: Contributions, dir_arg: str) -> int:
    folder = Path(expand_home(dir_arg, env.home)).resolve()
    if not folder.is_dir():
        print(f"not a folder: {folder}", file=sys.stderr)
        return 1
    env, config = _configured(env)
    discovery = discover_folder(env, config, contributions, folder)
    times = machine_load_times(env)
    context = build_context(env, folder, discovery, _all_rules(env))
    entries = _finished_entries(env, contributions, discovery.entries, times)
    print(_serialize(document(entries, [context], _generated_at(env))))
    return 0


def _session(env: Environment, contributions: Contributions, session_id: str) -> int:
    env, config = _configured(env)
    try:
        session = read_session(env, session_id)
        env = env.judged_by(session.config_dir)
        discovery = discover_folder(env, config, contributions, session.folder)
        reaching = _reaching_entries(env, session.folder, discovery)
        context, new_entries = session_context(env, session, discovery.entries, reaching)
    except SessionNotFound as exc:
        print(str(exc), file=sys.stderr)
        return 1
    times = session_load_times(session.transcript)
    entries = _finished_entries(env, contributions, [*discovery.entries, *new_entries], times)
    print(_serialize(document(entries, [context], _generated_at(env))))
    return 0


def _loads_check(env: Environment, contributions: Contributions, session_id: str) -> int:
    """Print each entry Claude Code's rules predict at launch for the
    session's folder that a check point of its transcripts leaves out; every
    point, a subagent's included, is checked against that one folder."""
    env, config = _configured(env)
    try:
        session = read_session(env, session_id)
    except SessionNotFound as exc:
        print(str(exc), file=sys.stderr)
        return 1
    env = env.judged_by(session.config_dir)
    discovery = discover_folder(env, config, contributions, session.folder)
    context = build_context(env, session.folder, discovery, [ClaudeRules(env)])
    launch = [entry for entry in discovery.entries
              if entry.id in context.states and context.states[entry.id][ClaudeRules.harness].state == "launch"]
    missing = missing_loads(check_points(session.transcript), launch)
    print(_serialize({"session": session_id, "folder": str(session.folder), "missing": missing}))
    return 0


def _finished_entries(env: Environment, contributions: Contributions, entries: list[Entry],
                      times: LoadTimes) -> list[Entry]:
    """Each entry, in order, as the index document holds it: with its last-loaded
    time, its headings and its links."""
    return with_doc_fields(_with_last_loaded(env, entries, times), env.home, contributions.link_prefixes)


def _with_last_loaded(env: Environment, entries: list[Entry], times: LoadTimes) -> list[Entry]:
    """Each entry, in order, with its last-loaded time from times."""
    return [replace(entry, last_loaded=last_loaded(env, entry, times)) for entry in entries]


def _all_rules(env: Environment) -> list[LoadRules]:
    return [ClaudeRules(env), CodexRules(env)]


def _reaching_entries(env: Environment, real_folder: Path, discovery: Discovery) -> list[Entry]:
    """The discovered entries a session opened in real_folder can reach: each
    entry with a location whose owner reaches the folder (see _owner_reaches)
    — the real path's owner, or the owner of a walk that reached it through a
    link. A holding repo's name comes from discovery when it named the repo,
    else from its origin; an in-repo feature home reaches by its repo's root
    from discovery."""
    repo_names = {discovery.repo_names.get(str(root)) or env.origin_name(root)
                  for root in repo_roots_holding(real_folder)}
    return [entry for entry in discovery.entries
            if any(_owner_reaches(location.owner, real_folder, repo_names, discovery.in_repo_feature_homes)
                   for location in entry.locations)]


def _owner_reaches(owner: Owner, folder: Path, repo_names: set[str], in_repo_feature_homes: dict[str, str]) -> bool:
    """The reach rule: the global layer and plugins reach every folder; a
    repo reaches the folders it holds and those above it (its files load on
    demand there); an in-repo feature home, one of in_repo_feature_homes,
    reaches what its own repo reaches, so a clone's home stays out of
    another clone's folders; an out-of-repo feature home reaches the
    folders of every repo, every clone, it is named for."""
    if owner.source in SHARED_SOURCES:
        return True
    if owner.source == "repo":
        return owner.root is not None and _repo_reaches(Path(owner.root), folder)
    if owner.source != "features":
        return False
    home_repo_root = in_repo_feature_homes.get(owner.root)
    if home_repo_root is not None:
        return _repo_reaches(Path(home_repo_root), folder)
    return owner.repo in repo_names


def _repo_reaches(real_root: Path, folder: Path) -> bool:
    """Whether the repo at real_root holds folder or sits below it."""
    return folder.is_relative_to(real_root) or real_root.is_relative_to(folder)


def _generated_at(env: Environment) -> str:
    return env.now().strftime(GENERATED_AT_FORMAT)


def _serialize(doc: dict) -> str:
    return json.dumps(doc, indent=2, ensure_ascii=False)


def _write_index(path: Path, text: str) -> None:
    """Write through a temp file in the same folder, so a reader never sees a half-written index."""
    write_through_temp(path, path.with_suffix(".json.tmp"), text + "\n")


if __name__ == "__main__":
    sys.exit(main())
