"""main runs each command over a temp home with a fixed clock, a config the
test writes and the user's contributions file (USER_CONTRIBUTIONS); nothing on
the real machine is read or written."""

import io
import json
import os
import subprocess
import tempfile
import unittest
from collections import Counter
from contextlib import redirect_stderr, redirect_stdout
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

import session
from docs_index import INDEX_PATH_PARTS, main
from environment import Environment
from loads import LOADS_PATH_PARTS

FIXED_NOW = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
USER_CONTRIBUTIONS = {
    "version": 1,
    "globalFolders": [{"path": "~/wigley-agents", "referenceFiles": ["decisions.md"],
                       "subfolders": ["learning", "wiki"], "skip": ["archive", "learning/archive"]}],
    "linkPrefixes": {"wigley:": "wigley@wigley-ai-marketplace"},
    "features": {"homes": ["{repo}/docs/features", "~/wigley-features/{name}"], "file": "followups.md",
                 "areaFolder": "followups"},
}


def _read_row(path, timestamp):
    return {"type": "assistant", "timestamp": timestamp,
            "message": {"content": [{"type": "tool_use", "name": "Read", "input": {"file_path": str(path)}}]}}


@dataclass(frozen=True)
class _OriginCountingEnvironment(Environment):
    """An Environment counting its origin_name calls per repo root."""
    origin_calls: Counter = field(default_factory=Counter)

    def origin_name(self, repo_root: Path) -> str:
        self.origin_calls[repo_root] += 1
        return super().origin_name(repo_root)


class DocsIndexTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(os.path.realpath(tmp.name))
        self.home = root / "home"
        self.dev = root / "dev"
        self.dev.mkdir()
        self._write_config([self.dev])
        self.env = Environment(home=self.home, now=lambda: FIXED_NOW)
        self.contributions = root / "contributions.json"
        self.contributions.write_text(json.dumps(USER_CONTRIBUTIONS), encoding="utf-8")

    def _write_config(self, roots, claude_config_dirs=None):
        config = self.home / ".agents" / "wigley-docs" / "config.json"
        config.parent.mkdir(parents=True, exist_ok=True)
        values = {
            "roots": [str(root) for root in roots],
            "ignore": [],
        }
        if claude_config_dirs is not None:
            values["claudeConfigDirs"] = claude_config_dirs
        config.write_text(json.dumps(values), encoding="utf-8")

    def _repo_with_agents_md(self, name):
        repo = self.dev / name
        repo.mkdir()
        subprocess.run(["git", "init", str(repo)], check=True, capture_output=True)
        (repo / "AGENTS.md").write_text("# Agents\n", encoding="utf-8")
        return repo

    def _run(self, argv, contributions=True):
        out, err = io.StringIO(), io.StringIO()
        options = ["--contributions", str(self.contributions)] if contributions else []
        with redirect_stdout(out), redirect_stderr(err):
            code = main([*options, *argv], self.env)
        return code, out.getvalue(), err.getvalue()

    def test_contributions_option_reaches_discover(self):
        repo = self._repo_with_agents_md("a")
        global_doc = self.home / "wigley-agents" / "AGENTS.md"
        global_doc.parent.mkdir(parents=True)
        global_doc.write_text("# Global\n", encoding="utf-8")
        checklist = repo / "docs" / "features" / "feat" / "checklist.md"
        checklist.parent.mkdir(parents=True)
        checklist.write_text("# Feat\n", encoding="utf-8")
        rows = [(["build", "--stdout"], True), (["context", str(repo)], True), (["build", "--stdout"], False)]

        for argv, with_file in rows:
            with self.subTest(argv=argv[0], with_file=with_file):
                code, out, _ = self._run(argv, contributions=with_file)

                self.assertEqual(code, 0)
                ids = {entry["id"] for entry in json.loads(out)["entries"]}
                self.assertEqual((str(global_doc) in ids, str(checklist) in ids), (with_file, with_file))

    def test_build_writes_index_with_repo_context(self):
        repo = self._repo_with_agents_md("a")
        agents_md = str(repo / "AGENTS.md")

        code, _, _ = self._run(["build"])

        self.assertEqual(code, 0)
        doc = json.loads(self.home.joinpath(*INDEX_PATH_PARTS).read_text(encoding="utf-8"))
        self.assertEqual(doc["schemaVersion"], 5)
        self.assertEqual(doc["generatedAt"], "2026-01-02T03:04:05Z")
        self.assertIn(agents_md, [entry["id"] for entry in doc["entries"]])
        repo_context = next(context for context in doc["contexts"] if context["folder"] == str(repo))
        self.assertEqual(set(repo_context["states"][agents_md]), {"claude", "codex"})

    def test_each_command_emits_the_doc_fields(self):
        repo = self._repo_with_agents_md("a")
        agents_md = repo / "AGENTS.md"
        agents_md.write_text("## Own\n\n§ Own\n", encoding="utf-8")
        unfound = self.home / "notes" / "unfound.md"
        unfound.parent.mkdir()
        unfound.write_text("# Unfound\n", encoding="utf-8")
        self._write_transcript(
            "s1",
            {"type": "user", "cwd": str(repo)},
            {"type": "attachment", "attachment": {"type": "instructions", "files": [{"path": str(unfound)}]}},
        )
        rows = [["build", "--stdout"], ["context", str(repo)], ["session", "s1"]]

        for argv in rows:
            with self.subTest(argv=argv[0]):
                code, out, _ = self._run(argv)

                self.assertEqual(code, 0)
                entries = {entry["id"]: entry for entry in json.loads(out)["entries"]}
                entry = entries[str(agents_md)]
                self.assertEqual(entry["headings"], [{"level": 2, "text": "Own", "line": 1}])
                self.assertEqual(entry["links"], [{"form": "section", "raw": "§ Own", "target": str(agents_md),
                                                   "line": 3, "targetLine": 1}])
                if argv[0] == "session":
                    self.assertEqual(entries[str(unfound)]["headings"], [{"level": 1, "text": "Unfound", "line": 1}])

    def test_context_for_subfolder_prints_one_context_for_it(self):
        repo = self._repo_with_agents_md("a")
        sub = repo / "sub"
        sub.mkdir()

        code, out, _ = self._run(["context", str(sub)])

        self.assertEqual(code, 0)
        doc = json.loads(out)
        self.assertEqual([context["folder"] for context in doc["contexts"]], [str(sub)])

    def test_build_repo_context_leaves_out_another_repos_entries(self):
        repo_a = self._repo_with_agents_md("a")
        repo_b = self._repo_with_agents_md("b")
        self._run(["build"])

        doc = json.loads(self.home.joinpath(*INDEX_PATH_PARTS).read_text(encoding="utf-8"))
        a_context = next(context for context in doc["contexts"] if context["folder"] == str(repo_a))
        self.assertIn(str(repo_a / "AGENTS.md"), a_context["states"])
        self.assertNotIn(str(repo_b / "AGENTS.md"), a_context["states"])

    def test_build_keeps_each_clones_in_repo_feature_home_to_that_clone(self):
        clones = [self._repo_with_agents_md(name) for name in ("clone-a", "clone-b")]
        checklists = {}
        for clone in clones:
            subprocess.run(["git", "-C", str(clone), "remote", "add", "origin", "git@host:me/shared.git"],
                           check=True, capture_output=True)
            checklists[clone] = clone / "docs" / "features" / "feat" / "checklist.md"
            checklists[clone].parent.mkdir(parents=True)
            checklists[clone].write_text("# Feat\n", encoding="utf-8")
        out_of_repo = self.home / "wigley-features" / "shared" / "feat" / "checklist.md"
        out_of_repo.parent.mkdir(parents=True)
        out_of_repo.write_text("# Feat\n", encoding="utf-8")

        _, contexts = self._build_contexts()

        clone_a, clone_b = clones
        self.assertIn(str(checklists[clone_a]), contexts[str(clone_a)])
        self.assertNotIn(str(checklists[clone_b]), contexts[str(clone_a)])
        self.assertIn(str(checklists[clone_b]), contexts[str(clone_b)])
        self.assertNotIn(str(checklists[clone_a]), contexts[str(clone_b)])
        for clone in clones:
            self.assertIn(str(out_of_repo), contexts[str(clone)])

    def test_session_context_leaves_out_a_nested_repo_not_holding_the_cwd(self):
        outer = self._repo_with_agents_md("outer")
        cwd = outer / "app"
        cwd.mkdir()
        nested = outer / "nested"
        nested.mkdir()
        subprocess.run(["git", "init", str(nested)], check=True, capture_output=True)
        (nested / "AGENTS.md").write_text("# Nested\n", encoding="utf-8")
        transcript = self.home / ".claude" / "projects" / "-dev-outer" / "s1.jsonl"
        transcript.parent.mkdir(parents=True)
        transcript.write_text(json.dumps({"type": "user", "cwd": str(cwd)}) + "\n", encoding="utf-8")

        code, out, _ = self._run(["session", "s1"])

        self.assertEqual(code, 0)
        doc = json.loads(out)
        self.assertIn(str(nested / "AGENTS.md"), [entry["id"] for entry in doc["entries"]])
        states = doc["contexts"][0]["states"]
        self.assertIn(str(outer / "AGENTS.md"), states)
        self.assertNotIn(str(nested / "AGENTS.md"), states)

    def test_context_holds_a_nested_repo_below_the_folder(self):
        outer = self._repo_with_agents_md("outer")
        nested = outer / "nested"
        nested.mkdir()
        subprocess.run(["git", "init", str(nested)], check=True, capture_output=True)
        (nested / "CLAUDE.md").write_text("# Nested\n", encoding="utf-8")

        code, out, _ = self._run(["context", str(outer)])

        self.assertEqual(code, 0)
        states = json.loads(out)["contexts"][0]["states"]
        nested_claude_md = states[str(nested / "CLAUDE.md")]
        self.assertEqual(nested_claude_md["claude"]["state"], "on-demand")
        self.assertEqual(nested_claude_md["codex"]["state"], "not-loaded")

    def test_context_states_symlinked_user_files_by_where_they_are_linked_from(self):
        dotfiles = self.dev.parent / "dotfiles"
        user_claude_md = dotfiles / "CLAUDE.md"
        imported = dotfiles / "shared.md"
        skill = dotfiles / "skills" / "s" / "SKILL.md"
        skill.parent.mkdir(parents=True)
        user_claude_md.write_text("@~/.claude/shared.md\n", encoding="utf-8")
        imported.write_text("# Shared\n", encoding="utf-8")
        skill.write_text("---\nname: s\n---\n", encoding="utf-8")
        (self.home / ".claude" / "skills").mkdir(parents=True)
        os.symlink(user_claude_md, self.home / ".claude" / "CLAUDE.md")
        os.symlink(imported, self.home / ".claude" / "shared.md")
        os.symlink(skill.parent, self.home / ".claude" / "skills" / "s")
        repo = self._repo_with_agents_md("r")
        repo_skill = repo / ".agents" / "skills" / "k" / "SKILL.md"
        repo_skill.parent.mkdir(parents=True)
        repo_skill.write_text("---\nname: k\n---\n", encoding="utf-8")
        (repo / ".claude" / "skills").mkdir(parents=True)
        os.symlink("../../.agents/skills/k", repo / ".claude" / "skills" / "k")

        code, out, _ = self._run(["context", str(repo)])

        self.assertEqual(code, 0)
        states = json.loads(out)["contexts"][0]["states"]
        self.assertEqual(states[str(user_claude_md)]["claude"]["state"], "launch")
        self.assertEqual(states[str(imported)]["claude"]["state"], "launch")
        self.assertEqual(states[str(skill)]["claude"]["state"], "listed")
        self.assertEqual(states[str(repo_skill)]["claude"]["state"], "listed")
        self.assertEqual(states[str(repo_skill)]["codex"]["state"], "listed")

    def _build_contexts(self):
        self._run(["build"])
        doc = json.loads(self.home.joinpath(*INDEX_PATH_PARTS).read_text(encoding="utf-8"))
        return doc, {context["folder"]: context["states"] for context in doc["contexts"]}

    def test_a_skill_linked_across_repos_has_a_state_in_both_repos_in_either_walk_order(self):
        pairs = []
        for owner_name, linker_name in (("a", "b"), ("d", "c")):
            owner_repo = self._repo_with_agents_md(owner_name)
            skill = owner_repo / ".agents" / "skills" / "s" / "SKILL.md"
            skill.parent.mkdir(parents=True)
            skill.write_text("---\nname: s\n---\n", encoding="utf-8")
            linker = self._repo_with_agents_md(linker_name)
            (linker / ".claude" / "skills").mkdir(parents=True)
            os.symlink(skill.parent, linker / ".claude" / "skills" / "s")
            pairs.append((owner_repo, linker, str(skill)))

        doc, contexts = self._build_contexts()

        built = {entry["id"]: entry for entry in doc["entries"]}
        for owner_repo, linker, skill_id in pairs:
            with self.subTest(owner=owner_repo.name, linker=linker.name):
                self.assertEqual(built[skill_id]["root"], str(owner_repo))
                self.assertEqual(contexts[str(owner_repo)][skill_id]["codex"]["state"], "listed")
                self.assertEqual(contexts[str(linker)][skill_id]["claude"]["state"], "listed")
                _, out, _ = self._run(["context", str(linker)])
                in_context = {entry["id"]: entry for entry in json.loads(out)["entries"]}[skill_id]
                self.assertEqual((in_context["repo"], in_context["root"]), (owner_repo.name, str(owner_repo)))

    def test_a_user_rule_in_a_linked_folder_launches_for_claude(self):
        rule = self.dev.parent / "dotfiles" / "rules" / "style.md"
        rule.parent.mkdir(parents=True)
        rule.write_text("# Style\n", encoding="utf-8")
        (self.home / ".claude" / "rules").mkdir(parents=True)
        os.symlink(rule.parent, self.home / ".claude" / "rules" / "team")
        repo = self._repo_with_agents_md("r")

        _, out, _ = self._run(["context", str(repo)])

        self.assertEqual(json.loads(out)["contexts"][0]["states"][str(rule)]["claude"]["state"], "launch")

    def _install_plugin(self, enabled):
        """Plugin p@m installed for the user, enabled or not in ~/.claude/settings.json; its install folder."""
        install = self.dev.parent / "cache" / "m" / "p" / "1.0.0"
        (install / "skills").mkdir(parents=True)
        installed = self.home / ".claude" / "plugins" / "installed_plugins.json"
        installed.parent.mkdir(parents=True)
        installed.write_text(json.dumps({"plugins": {
            "p@m": [{"scope": "user", "installPath": str(install), "version": "1.0.0"}],
        }}), encoding="utf-8")
        (self.home / ".claude" / "settings.json").write_text(
            json.dumps({"enabledPlugins": {"p@m": enabled}}), encoding="utf-8")
        return install

    def test_an_enabled_plugins_skill_linked_into_a_repo_is_listed_as_the_plugins(self):
        install = self._install_plugin(enabled=True)
        repo = self._repo_with_agents_md("r")
        skill = repo / "skills" / "s" / "SKILL.md"
        skill.parent.mkdir(parents=True)
        skill.write_text("---\nname: s\n---\n", encoding="utf-8")
        os.symlink(skill.parent, install / "skills" / "s")
        transcript = self.home / ".claude" / "projects" / "-dev-r" / "s1.jsonl"
        transcript.parent.mkdir(parents=True)
        transcript.write_text("\n".join([
            json.dumps({"type": "user", "cwd": str(repo)}),
            json.dumps({"type": "attachment", "attachment": {"type": "skill_listing", "names": ["p:s"]}}),
        ]) + "\n", encoding="utf-8")

        _, context_out, _ = self._run(["context", str(repo)])
        _, session_out, _ = self._run(["session", "s1"])

        in_context = json.loads(context_out)["contexts"][0]["states"][str(skill)]["claude"]
        self.assertEqual(in_context["state"], "listed")
        self.assertIn("p@m", in_context["reason"])
        in_session = json.loads(session_out)["contexts"][0]["states"][str(skill)]["claude"]
        self.assertEqual(in_session["state"], "listed")

    def test_build_states_a_merged_clone_skill_by_its_enabled_install(self):
        clone = self._repo_with_agents_md("mkt")
        subprocess.run(["git", "-C", str(clone), "remote", "add", "origin", "git@github-personal:Me/Mkt.git"],
                       check=True, capture_output=True)
        self._write_doc(clone / ".claude-plugin" / "marketplace.json").write_text(
            json.dumps({"name": "mkt", "plugins": [{"name": "p", "source": "./plugins/p"}]}), encoding="utf-8")
        clone_skill = self._write_doc(clone / "plugins" / "p" / "skills" / "k" / "SKILL.md")
        install = self.dev.parent / "cache" / "mkt" / "p" / "1.0.0"
        install_skill = self._write_doc(install / "skills" / "k" / "SKILL.md")
        plugins = self.home / ".claude" / "plugins"
        self._write_doc(plugins / "installed_plugins.json").write_text(json.dumps({"plugins": {
            "p@mkt": [{"scope": "user", "installPath": str(install), "version": "1.0.0"}],
        }}), encoding="utf-8")
        (plugins / "known_marketplaces.json").write_text(
            json.dumps({"mkt": {"source": {"source": "git", "url": "https://github.com/me/mkt"}}}), encoding="utf-8")
        (self.home / ".claude" / "settings.json").write_text(
            json.dumps({"enabledPlugins": {"p@mkt": True}}), encoding="utf-8")

        doc, contexts = self._build_contexts()

        self.assertEqual(contexts[str(self.home)][str(clone_skill)]["claude"],
                         {"state": "listed", "reason": "skill of enabled plugin p@mkt"})
        entry = next(entry for entry in doc["entries"] if entry["id"] == str(clone_skill))
        self.assertEqual(entry["owner"], "mine")
        self.assertEqual(entry["meta"]["installed"][0]["path"], str(install_skill))

    def test_a_user_skill_linked_into_a_disabled_plugins_cache_is_listed_as_a_user_skill(self):
        install = self._install_plugin(enabled=False)
        skill = install / "skills" / "x" / "SKILL.md"
        skill.parent.mkdir()
        skill.write_text("---\nname: x\n---\n", encoding="utf-8")
        (self.home / ".claude" / "skills").mkdir(parents=True)
        os.symlink(skill.parent, self.home / ".claude" / "skills" / "x")
        repo = self._repo_with_agents_md("r")

        _, out, _ = self._run(["context", str(repo)])

        state = json.loads(out)["contexts"][0]["states"][str(skill)]["claude"]
        self.assertEqual(state["state"], "listed")
        self.assertIn("user skill", state["reason"])

    def test_context_of_a_folder_above_a_root_holds_its_repos_as_build_home_context_does(self):
        self.dev = self.home / "code"
        self.dev.mkdir()
        self._write_config([self.dev])
        repo = self._repo_with_agents_md("r")
        agents_md = str(repo / "AGENTS.md")
        _, contexts = self._build_contexts()

        code, out, _ = self._run(["context", str(self.home)])

        self.assertEqual(code, 0)
        states = json.loads(out)["contexts"][0]["states"]
        self.assertEqual(states[agents_md], contexts[str(self.home)][agents_md])

    def test_context_expands_a_leading_tilde_against_the_home(self):
        project = self.home / "project"
        project.mkdir(parents=True)

        code, out, _ = self._run(["context", "~/project"])

        self.assertEqual(code, 0)
        self.assertEqual([context["folder"] for context in json.loads(out)["contexts"]], [str(project)])

    def test_context_of_a_missing_folder_fails(self):
        missing = self.dev / "missing"

        code, out, err = self._run(["context", str(missing)])

        self.assertEqual(code, 1)
        self.assertEqual(out, "")
        self.assertIn(str(missing), err)

    def test_session_without_transcript_fails_naming_the_id(self):
        code, out, err = self._run(["session", "x"])

        self.assertEqual(code, 1)
        self.assertEqual(out, "")
        self.assertIn("session x", err)

    def test_build_names_each_repo_once(self):
        outer = self._repo_with_agents_md("outer")
        inner = self._repo_with_agents_md("outer/inner")
        self.env = _OriginCountingEnvironment(home=self.home, now=lambda: FIXED_NOW)

        code, _, _ = self._run(["build"])

        self.assertEqual(code, 0)
        self.assertEqual(self.env.origin_calls, Counter({outer: 1, inner: 1}))

    def test_session_finds_the_transcript_once_and_reads_it_for_states_and_times(self):
        repo = self._repo_with_agents_md("a")
        transcript = self.home / ".claude" / "projects" / "-dev-a" / "s1.jsonl"
        transcript.parent.mkdir(parents=True)
        transcript.write_text("\n".join([
            json.dumps({"type": "user", "cwd": str(repo)}),
            json.dumps({"type": "attachment",
                        "attachment": {"type": "instructions", "files": [{"path": str(repo / "AGENTS.md")}]}}),
        ]) + "\n", encoding="utf-8")
        opened = []
        real_open = Path.open

        def counting_open(path, *args, **kwargs):
            opened.append(path)
            return real_open(path, *args, **kwargs)

        with (mock.patch.object(Path, "open", counting_open),
              mock.patch("session._transcript_path", wraps=session._transcript_path) as lookup):
            code, out, _ = self._run(["session", "s1"])

        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)["contexts"][0]["states"][str(repo / "AGENTS.md")]["claude"]["state"], "launch")
        self.assertEqual(lookup.call_count, 1)
        self.assertEqual([path for path in opened if path == transcript], [transcript, transcript])

    def _write_transcript(self, name, *rows):
        transcript = self.home / ".claude" / "projects" / "-dev-a" / f"{name}.jsonl"
        transcript.parent.mkdir(parents=True, exist_ok=True)
        transcript.write_text("".join(json.dumps(row, separators=(",", ":")) + "\n" for row in rows),
                              encoding="utf-8")
        return transcript

    def test_build_writes_last_loaded_and_the_loads_cache(self):
        repo = self._repo_with_agents_md("a")
        (repo / "CLAUDE.md").write_text("# Claude\n", encoding="utf-8")
        self._write_transcript("s1", _read_row(repo / "AGENTS.md", "2026-10-26T21:01:32.174Z"))

        code, _, _ = self._run(["build"])

        self.assertEqual(code, 0)
        doc = json.loads(self.home.joinpath(*INDEX_PATH_PARTS).read_text(encoding="utf-8"))
        entries = {entry["id"]: entry for entry in doc["entries"]}
        self.assertEqual(entries[str(repo / "AGENTS.md")]["lastLoaded"], "2026-10-26T21:01:32.174Z")
        self.assertIsNone(entries[str(repo / "CLAUDE.md")]["lastLoaded"])
        cache = json.loads(self.home.joinpath(*LOADS_PATH_PARTS).read_text(encoding="utf-8"))
        self.assertEqual(cache["version"], 1)

    def test_a_failed_index_write_raises_and_leaves_no_temp_file(self):
        self._repo_with_agents_md("a")
        index_path = self.home.joinpath(*INDEX_PATH_PARTS)
        real_replace = os.replace

        def failing_replace(src, dst):
            if Path(dst) == index_path:
                raise OSError("disk full")
            real_replace(src, dst)

        with mock.patch("os.replace", side_effect=failing_replace):
            with self.assertRaises(OSError):
                self._run(["build"])

        self.assertFalse(index_path.exists())
        self.assertEqual(list(index_path.parent.glob("*.tmp")), [])

    def test_context_prints_last_loaded_and_writes_the_loads_cache(self):
        repo = self._repo_with_agents_md("a")
        self._write_transcript("s1", _read_row(repo / "AGENTS.md", "2026-10-26T21:01:32.174Z"))

        code, out, _ = self._run(["context", str(repo)])

        self.assertEqual(code, 0)
        entries = {entry["id"]: entry for entry in json.loads(out)["entries"]}
        self.assertEqual(entries[str(repo / "AGENTS.md")]["lastLoaded"], "2026-10-26T21:01:32.174Z")
        self.assertTrue(self.home.joinpath(*LOADS_PATH_PARTS).exists())

    def test_session_uses_only_its_own_transcripts_times(self):
        repo = self._repo_with_agents_md("a")
        extra = self._write_doc(self.home / "notes" / "extra.md")
        self._write_transcript(
            "s1",
            {"type": "user", "cwd": str(repo)},
            _read_row(repo / "AGENTS.md", "2026-10-01T00:00:00Z"),
            {"type": "attachment", "timestamp": "2026-10-01T00:00:01Z",
             "attachment": {"type": "instructions", "files": [{"path": str(extra)}]}},
        )
        self._write_transcript("s2", _read_row(repo / "AGENTS.md", "2026-10-05T00:00:00Z"))

        code, out, _ = self._run(["session", "s1"])

        self.assertEqual(code, 0)
        entries = {entry["id"]: entry for entry in json.loads(out)["entries"]}
        self.assertEqual(entries[str(repo / "AGENTS.md")]["lastLoaded"], "2026-10-01T00:00:00Z")
        self.assertEqual(entries[str(extra)]["lastLoaded"], "2026-10-01T00:00:01Z")
        self.assertFalse(self.home.joinpath(*LOADS_PATH_PARTS).exists())

    def _write_doc(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("# Doc\n", encoding="utf-8")
        return path

    def test_build_judges_claude_states_against_the_first_config_dir(self):
        self._write_config([self.dev], ["~/.claude-personal", "~/.claude"])
        personal_md = self._write_doc(self.home / ".claude-personal" / "CLAUDE.md")
        claude_md = self._write_doc(self.home / ".claude" / "CLAUDE.md")
        repo = self._repo_with_agents_md("a")

        _, contexts = self._build_contexts()

        states = contexts[str(repo)]
        self.assertEqual(states[str(personal_md)]["claude"]["state"], "launch")
        self.assertEqual(states[str(claude_md)]["claude"], {
            "state": "not-loaded",
            "reason": "in Claude config folder ~/.claude; states are judged against ~/.claude-personal",
        })

    def test_session_reads_a_transcript_from_a_later_config_dir(self):
        self._write_config([self.dev], ["~/.claude", "~/.claude-personal"])
        personal_md = self._write_doc(self.home / ".claude-personal" / "CLAUDE.md")
        claude_md = self._write_doc(self.home / ".claude" / "CLAUDE.md")
        repo = self._repo_with_agents_md("a")
        transcript = self.home / ".claude-personal" / "projects" / "-dev-a" / "s1.jsonl"
        transcript.parent.mkdir(parents=True)
        transcript.write_text("\n".join([
            json.dumps({"type": "user", "cwd": str(repo)}),
            json.dumps({"type": "attachment",
                        "attachment": {"type": "instructions", "files": [{"path": str(personal_md)}]}}),
        ]) + "\n", encoding="utf-8")

        code, out, _ = self._run(["session", "s1"])

        self.assertEqual(code, 0)
        doc = json.loads(out)
        self.assertEqual(doc["contexts"][0]["states"][str(personal_md)]["claude"]["state"], "launch")
        self.assertIn(str(claude_md), [entry["id"] for entry in doc["entries"]])

    def test_build_states_a_config_dir_linked_into_the_other_once_in_either_order(self):
        claude = self.home / ".claude"
        claude_md = self._write_doc(claude / "CLAUDE.md")
        skill = claude / "skills" / "s" / "SKILL.md"
        skill.parent.mkdir(parents=True)
        skill.write_text("---\nname: s\n---\n", encoding="utf-8")
        personal = self.home / ".claude-personal"
        personal.mkdir()
        os.symlink(claude / "skills", personal / "skills")
        os.symlink(claude_md, personal / "CLAUDE.md")
        repo = self._repo_with_agents_md("a")

        for config_dirs in (["~/.claude-personal", "~/.claude"], ["~/.claude", "~/.claude-personal"]):
            with self.subTest(claude_config_dirs=config_dirs):
                self._write_config([self.dev], config_dirs)

                doc, contexts = self._build_contexts()

                skill_ids = [entry["id"] for entry in doc["entries"] if entry["kind"] == "skill"]
                self.assertEqual(skill_ids, [str(skill)])
                states = contexts[str(repo)]
                self.assertEqual(states[str(skill)]["claude"]["state"], "listed")
                self.assertEqual(states[str(claude_md)]["claude"]["state"], "launch")

    def test_session_matches_a_synced_skill_in_its_own_config_dir_listed_second(self):
        self._write_config([self.dev], ["~/.claude", "~/.claude-personal"])
        personal = self.home / ".claude-personal"
        skill = personal / "skills" / "synced" / "b" / "x" / "SKILL.md"
        skill.parent.mkdir(parents=True)
        skill.write_text("---\nname: x\n---\n", encoding="utf-8")
        repo = self._repo_with_agents_md("a")
        transcript = personal / "projects" / "-dev-a" / "s1.jsonl"
        transcript.parent.mkdir(parents=True)
        transcript.write_text("\n".join([
            json.dumps({"type": "user", "cwd": str(repo)}),
            json.dumps({"type": "attachment",
                        "attachment": {"type": "skill_listing", "names": ["anthropic-skills:x"]}}),
        ]) + "\n", encoding="utf-8")

        code, out, _ = self._run(["session", "s1"])

        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)["contexts"][0]["states"][str(skill)]["claude"]["state"], "listed")


if __name__ == "__main__":
    unittest.main()
