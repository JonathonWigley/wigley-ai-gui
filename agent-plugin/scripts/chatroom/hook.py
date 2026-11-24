"""The chatroom's Claude Code hook: before an edit or a `git commit`, and after an edit, it sends the app one neutral
request naming the touched paths and prints the app's reply text as `additionalContext`. It never blocks a tool, always
exits 0, and prints nothing when the app is away, refuses, or does not answer within HOOK_DEADLINE_SECONDS.
`hooks/hooks.json` runs it as `hook.py pre` and `hook.py post`; it talks to the app through relay/hook_client.py, and
relay/README.md § The relay holds the wire. Standard library only.
"""

from __future__ import annotations

import json
import os
import shlex
import subprocess
import sys
import time
from pathlib import Path
from typing import Callable, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "relay"))

import hook_client  # noqa: E402
from hook_client import HOOK_DEADLINE_SECONDS  # noqa: E402

GIT_TIMEOUT_SECONDS = 1.0

RunGit = Callable[[list[str], str], Optional[str]]

EVENT_NAMES = {"pre": "PreToolUse", "post": "PostToolUse"}
HOOK_NAMES = {"pre": "chatroom.pre", "post": "chatroom.post"}
FILE_TOOLS = {"Edit": "edit", "MultiEdit": "edit", "NotebookEdit": "edit", "Write": "write"}
OPERATOR_CHARACTERS = frozenset("();<>|&")
GIT_FOLDER_OPTION = "-C"
GIT_PAIR_OPTIONS = frozenset({"-C", "-c"})
COMMIT_VALUE_LETTERS = frozenset("mFCct")
COMMIT_ATTACHED_VALUE_LETTERS = frozenset("uS")
COMMIT_VALUE_OPTIONS = frozenset({
    "-m", "-F", "-C", "-c", "-t", "--message", "--file", "--author", "--date", "--template", "--reuse-message",
    "--reedit-message", "--fixup", "--squash", "--cleanup", "--trailer", "--pathspec-from-file",
})
PATHSPEC_FILE_OPTION = "--pathspec-from-file"
ADD_ALL_LETTERS = frozenset("Au")
ADD_ALL_OPTIONS = frozenset({"--all", "--update", "--no-ignore-removal"})


def git_runner(deadline: float) -> RunGit:
    """A `run_git(args, cwd)` that runs `git <args>` in `cwd` within GIT_TIMEOUT_SECONDS cut to the time left before
    `deadline` (a time.monotonic() value), and returns its stdout, or None on a non-zero exit, a timeout, a missing
    git, or no time left."""
    def run_git(args: list[str], cwd: str) -> str | None:
        time_left = deadline - time.monotonic()
        if time_left <= 0:
            return None
        try:
            completed = subprocess.run(["git", *args], cwd=cwd, stdin=subprocess.DEVNULL, capture_output=True,
                                       encoding="utf-8", errors="replace",
                                       timeout=min(GIT_TIMEOUT_SECONDS, time_left))
        except (OSError, subprocess.SubprocessError):
            return None
        return completed.stdout if completed.returncode == 0 else None
    return run_git


def request_from_input(event: str, hook_input: dict, run_git: RunGit) -> dict | None:
    """The neutral request for the app, or None when this call sends none: `pre` sends for Edit, Write, MultiEdit,
    NotebookEdit and a Bash command that runs `git commit`; `post` for the four file tools only. A commit's `cwd` is
    the folder its git runs in, the hook's cwd joined with each `-C` folder."""
    if not isinstance(hook_input, dict):
        return None
    tool_name = hook_input.get("tool_name")
    tool_input = hook_input.get("tool_input")
    cwd = hook_input.get("cwd")
    if not isinstance(tool_input, dict) or not isinstance(cwd, str):
        return None
    if tool_name in FILE_TOOLS:
        tool = FILE_TOOLS[tool_name]
        path = tool_input.get("notebook_path" if tool_name == "NotebookEdit" else "file_path")
        paths = [path] if isinstance(path, str) and path else None
    elif tool_name == "Bash" and event == "pre":
        tool = "commit"
        command = tool_input.get("command")
        paths = commit_paths(command, cwd, run_git) if isinstance(command, str) else None
        if paths is not None:
            cwd = commit_folder(command, cwd)
    else:
        return None
    if paths is None:
        return None
    agent_id = hook_input.get("agent_id")
    return {"tool": tool, "paths": paths, "agentId": agent_id if isinstance(agent_id, str) else None, "cwd": cwd}


def commit_paths(command: str, cwd: str, run_git: RunGit) -> list[str] | None:
    """The absolute paths the first `git commit` in `command` would commit: staged paths, tracked changes under `-a`,
    what each earlier `git add` on the line stages (its pathspec, or the top level of its git folder for a bare `-A`
    or `-u`, which stages the whole working tree), and the commit's own pathspec. A commit given a pathspec (or
    `--pathspec-from-file`) without `-i`, or under `-o`, commits its pathspec alone, as git does. None when `command`
    runs no `git commit` or does not tokenize. A failed read of the staged or tracked paths adds nothing and ends those
    reads; a bare add whose top-level read fails names its git folder."""
    commit = _find_commit(command, cwd)
    if commit is None:
        return None
    tokens, git_at, command_at, folder = commit
    pathspec, is_all, is_only = _read_commit_args(_until_operator(tokens, command_at + 1))
    paths = []
    if not is_only:
        top_levels = {}
        paths += _git_changed_paths(folder, is_all, run_git, top_levels)
        paths += _earlier_add_pathspec(tokens[:git_at], cwd, run_git, top_levels)
    paths += [_absolute(folder, path) for path in pathspec]
    return list(dict.fromkeys(paths))


def commit_folder(command: str, cwd: str) -> str | None:
    """The folder the first `git commit` in `command` runs in: `cwd` joined with its `-C` folders; None as for
    commit_paths."""
    commit = _find_commit(command, cwd)
    return None if commit is None else commit[3]


def ask_app(channel: str, hello: dict, request: dict, deadline: float) -> str | None:
    """Sends the hook hello and `request` on `channel` and returns the reply's `text`; None when the app refuses,
    the reply holds no text, the channel fails, or the reply line is not complete by `deadline`."""
    reply = hook_client.ask_app_reply(channel, hello, request, deadline)
    text = None if reply is None else reply.get("text")
    return text if isinstance(text, str) and text else None


def output_for(event: str, text: str | None) -> str:
    """The one stdout line carrying `text` as the event's additionalContext, or '' when there is no text."""
    if not text:
        return ""
    return json.dumps({"hookSpecificOutput": {"hookEventName": EVENT_NAMES[event], "additionalContext": text}})


def main(argv: list[str], stdin, stdout, env) -> int:
    """Runs the hook for `argv[0]` (`pre` or `post`) on the JSON input in `stdin` (text or bytes); always returns 0,
    an exception reported on stderr only."""
    deadline = time.monotonic() + HOOK_DEADLINE_SECONDS
    try:
        line = _hook_output(argv, stdin, env, deadline)
    except Exception as error:
        print(f"chatroom hook: {error!r}", file=sys.stderr)
        return 0
    if line:
        stdout.write(line + "\n")
    return 0


def _hook_output(argv: list[str], stdin, env, deadline: float) -> str:
    event = argv[0] if argv else None
    if event not in EVENT_NAMES:
        return ""
    try:
        hook_input = json.loads(stdin.read())
    except ValueError:
        return ""
    # The channel first, so an absent app costs no git reads.
    channel = hook_client.app_channel(env)
    if channel is None:
        return ""
    request = request_from_input(event, hook_input, git_runner(deadline))
    if request is None:
        return ""
    hello = hook_client.session_hello(HOOK_NAMES[event], hook_input, env)
    return output_for(event, ask_app(channel, hello, request, deadline))


def _tokens(command: str) -> list[str] | None:
    lexer = shlex.shlex(command, posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    try:
        return list(lexer)
    except ValueError:
        return None


def _is_operator(token: str) -> bool:
    return bool(token) and all(character in OPERATOR_CHARACTERS for character in token)


def _until_operator(tokens: list[str], start: int) -> list[str]:
    end = start
    while end < len(tokens) and not _is_operator(tokens[end]):
        end += 1
    return tokens[start:end]


def _git_commands(tokens: list[str]):
    """Each `git [-C <dir> | -c <k=v>]... <subcommand>` in `tokens`, as (git index, subcommand index, -C folders)."""
    for git_at, token in enumerate(tokens):
        if token != "git":
            continue
        command_at = git_at + 1
        folders = []
        while command_at + 1 < len(tokens) and tokens[command_at] in GIT_PAIR_OPTIONS:
            if tokens[command_at] == GIT_FOLDER_OPTION:
                folders.append(tokens[command_at + 1])
            command_at += 2
        if command_at < len(tokens):
            yield git_at, command_at, folders


def _first_git_command(tokens: list[str], subcommand: str) -> tuple[int, int, list[str]] | None:
    for git_at, command_at, folders in _git_commands(tokens):
        if tokens[command_at] == subcommand:
            return git_at, command_at, folders
    return None


def _find_commit(command: str, cwd: str) -> tuple[list[str], int, int, str] | None:
    """The tokens of `command`, and its first `git commit` as (git index, subcommand index, git folder); None when
    there is none or `command` does not tokenize."""
    tokens = _tokens(command)
    if tokens is None:
        return None
    commit = _first_git_command(tokens, "commit")
    if commit is None:
        return None
    git_at, command_at, folders = commit
    return tokens, git_at, command_at, _git_folder(cwd, folders)


def _git_folder(cwd: str, folders: list[str]) -> str:
    return os.path.normpath(os.path.join(cwd, *folders))


def _absolute(folder: str, path: str) -> str:
    return os.path.normpath(os.path.join(folder, path))


def _read_commit_args(args: list[str]) -> tuple[list[str], bool, bool]:
    """The commit's pathspec, whether it commits all tracked changes (`-a`), and whether it commits only its
    pathspec: under `-o`, or with a pathspec or `--pathspec-from-file` and no `-i`."""
    pathspec = []
    is_all = False
    is_only = False
    is_include = False
    has_pathspec_file = False
    is_after_separator = False
    at = 0
    while at < len(args):
        token = args[at]
        at += 1
        if is_after_separator:
            pathspec.append(token)
        elif token == "--":
            is_after_separator = True
        elif token.startswith("--"):
            is_all = is_all or token == "--all"
            is_only = is_only or token == "--only"
            is_include = is_include or token == "--include"
            has_pathspec_file = has_pathspec_file or token.split("=", 1)[0] == PATHSPEC_FILE_OPTION
            if token in COMMIT_VALUE_OPTIONS:
                at += 1
        elif token.startswith("-"):
            letters = token[1:]
            for index, letter in enumerate(letters):
                # `-u<mode>` and `-S<keyid>` take their value attached, so the letters after them are no flags.
                if letter in COMMIT_ATTACHED_VALUE_LETTERS:
                    break
                if letter in COMMIT_VALUE_LETTERS:
                    if index == len(letters) - 1:
                        at += 1
                    break
                is_all = is_all or letter == "a"
                is_only = is_only or letter == "o"
                is_include = is_include or letter == "i"
        else:
            pathspec.append(token)
    is_only = is_only or ((bool(pathspec) or has_pathspec_file) and not is_include)
    return pathspec, is_all, is_only


def _top_level(folder: str, run_git: RunGit, top_levels: dict[str, str | None]) -> str | None:
    """The top level of the repo `folder` sits in, read once per folder into `top_levels`; None when the read fails."""
    if folder not in top_levels:
        output = run_git(["rev-parse", "--show-toplevel"], folder)
        top_levels[folder] = None if output is None else output.strip()
    return top_levels[folder]


def _git_changed_paths(folder: str, is_all: bool, run_git: RunGit, top_levels: dict[str, str | None]) -> list[str]:
    """Staged paths, then tracked changes when `is_all`, absolute; stops at the first git call that fails."""
    top = _top_level(folder, run_git, top_levels)
    if top is None:
        return []
    reads = [["diff", "--cached", "--name-only", "-z"]]
    if is_all:
        reads.append(["diff", "--name-only", "-z"])
    paths = []
    for args in reads:
        output = run_git(args, folder)
        if output is None:
            break
        paths += [_absolute(top, path) for path in output.split("\0") if path]
    return paths


def _earlier_add_pathspec(tokens: list[str], cwd: str, run_git: RunGit, top_levels: dict[str, str | None]) -> list[str]:
    """The absolute pathspec of each `git add` in `tokens` (every token not starting with `-`, and every token after
    `--`), or, for an add with `-A`, `-u`, `--all`, `--update` or `--no-ignore-removal` and no pathspec, the top level
    of its git folder (git stages the whole working tree), or the folder itself when that read fails."""
    paths = []
    for _, command_at, folders in _git_commands(tokens):
        if tokens[command_at] != "add":
            continue
        folder = _git_folder(cwd, folders)
        pathspec = []
        is_all = False
        is_after_separator = False
        for token in _until_operator(tokens, command_at + 1):
            if is_after_separator or not token.startswith("-"):
                pathspec.append(_absolute(folder, token))
            elif token == "--":
                is_after_separator = True
            elif token.startswith("--"):
                is_all = is_all or token in ADD_ALL_OPTIONS
            else:
                is_all = is_all or not ADD_ALL_LETTERS.isdisjoint(token[1:])
        if pathspec or not is_all:
            paths += pathspec
        else:
            paths.append(_top_level(folder, run_git, top_levels) or folder)
    return paths


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:], sys.stdin.buffer, sys.stdout, os.environ))
