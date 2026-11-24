"""discover walks a temp home, a temp root of git repos and a temp features
home that each test builds; nothing on the real machine is read. Unless a
test says otherwise, the contributions are the user's: ~/wigley-agents as the
global folder, and the {repo}/docs/features and ~/wigley-features/{name}
features homes."""

import json
import os
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from config import Config
from contributions import Contributions, FeaturesHomes, GlobalFolder
from discover import _Scan, _walk_marketplace_clones, discover, discover_folder
from environment import Environment
from model import Installed, Location, Owner
from rules import is_repo_root

FIXED_NOW = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)


class DiscoverTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(os.path.realpath(tmp.name))
        self.home = self.root / "home"
        self.home.mkdir()
        self.dev = self.root / "dev"
        self.dev.mkdir()
        self.features = self.home / "wigley-features"
        self.env = Environment(home=self.home, now=lambda: FIXED_NOW)
        self.ignore = []
        self.contributions = self._contributions()

    def _contributions(self, file="followups.md", area_folder="followups", in_repo_parts=(("docs", "features"),)):
        global_folder = GlobalFolder(path=self.home / "wigley-agents", reference_files=("decisions.md",),
                                     subfolders=("learning", "wiki"), skip=("archive", "learning/archive"))
        features = FeaturesHomes(in_repo_parts=in_repo_parts, out_of_repo_folders=(self.features,), file=file,
                                 area_folder=area_folder)
        return Contributions(global_folders=[global_folder], link_prefixes={}, features=features)

    def _config(self):
        return Config(roots=[self.dev], ignore=self.ignore, claude_config_dirs=(self.home / ".claude",))

    def _write(self, path, text="# Doc\n"):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def _repo(self, path):
        path.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "init", str(path)], check=True, capture_output=True)
        return path

    def _discover(self):
        return {entry.id: entry for entry in discover(self.env, self._config(), self.contributions).entries}

    def test_nested_repos_symlinked_skills_and_global_imports(self):
        wigley_agents = self._write(self.home / "wigley-agents" / "AGENTS.md")
        user_claude = self._write(self.home / ".claude" / "CLAUDE.md", "@~/wigley-agents/AGENTS.md\n")
        repo = self._repo(self.dev / "r")
        repo_agents = self._write(repo / "AGENTS.md")
        skill = self._write(repo / ".agents" / "skills" / "s" / "SKILL.md", "---\nname: s\n---\n")
        (repo / ".claude").mkdir()
        os.symlink("../.agents/skills", repo / ".claude" / "skills")
        sub = self._repo(repo / "sub")
        sub_agents = self._write(sub / "AGENTS.md")

        entries = self._discover()

        self.assertEqual(entries[str(repo_agents)].root, str(repo))
        self.assertEqual(entries[str(sub_agents)].root, str(sub))
        skill_ids = {entry.id for entry in entries.values() if entry.kind == "skill"}
        self.assertEqual(skill_ids, {str(skill)})
        self.assertEqual(entries[str(wigley_agents)].source, "global")
        self.assertEqual(entries[str(user_claude)].meta["imports"], [str(wigley_agents)])

    def test_wigley_agents_linked_to_a_clone_under_a_root_stays_global(self):
        clone = self._repo(self.dev / "personal" / "wigley-agents")
        agents = self._write(clone / "AGENTS.md")
        os.symlink(clone, self.home / "wigley-agents")

        entries = self._discover()

        entry = entries[str(agents)]
        self.assertEqual((entry.source, entry.root), ("global", None))
        self.assertEqual(entry.walked, (Location(str(self.home / "wigley-agents" / "AGENTS.md"), Owner("global")),))
        self.assertEqual([other.id for other in entries.values() if other.path == str(agents)], [str(agents)])

    def test_a_skill_linked_across_repos_is_owned_by_its_real_repo_in_either_walk_order(self):
        for owner_name, linker_name in (("a", "b"), ("d", "c")):
            owner_repo = self._repo(self.dev / owner_name)
            skill = self._write(owner_repo / ".agents" / "skills" / "s" / "SKILL.md", "---\nname: s\n---\n")
            linker = self._repo(self.dev / linker_name)
            (linker / ".claude" / "skills").mkdir(parents=True)
            os.symlink(skill.parent, linker / ".claude" / "skills" / "s")
            with self.subTest(owner=owner_name, linker=linker_name):
                built = self._discover()[str(skill)]
                in_linker = {entry.id: entry for entry in
                             discover_folder(self.env, self._config(), self.contributions, linker).entries}[str(skill)]

                for entry in (built, in_linker):
                    self.assertEqual((entry.source, entry.root), ("repo", str(owner_repo)))
                    self.assertEqual([location.path for location in entry.walked],
                                     [str(linker / ".claude" / "skills" / "s" / "SKILL.md")])
                    self.assertEqual(entry.walked[0].owner.root, str(linker))

    def test_a_linked_folder_in_user_rules_is_walked_by_its_link_path(self):
        rule = self._write(self.root / "dotfiles" / "rules" / "style.md")
        (self.home / ".claude" / "rules").mkdir(parents=True)
        os.symlink(rule.parent, self.home / ".claude" / "rules" / "team")

        entry = self._discover()[str(rule)]

        self.assertEqual((entry.kind, entry.source), ("rule", "global"))
        self.assertEqual(entry.walked,
                         (Location(str(self.home / ".claude" / "rules" / "team" / "style.md"), Owner("global")),))

    def test_a_file_linked_into_an_ignored_repo_is_owned_by_the_walk_that_reached_it(self):
        outer = self._repo(self.dev / "b")
        ignored = self._repo(outer / "old")
        skill = self._write(ignored / "skills" / "s" / "SKILL.md", "---\nname: s\n---\n")
        linker = self._repo(self.dev / "a")
        (linker / ".claude" / "skills").mkdir(parents=True)
        os.symlink(skill.parent, linker / ".claude" / "skills" / "s")
        self.ignore = [str(ignored)]

        entry = self._discover()[str(skill)]

        self.assertEqual((entry.source, entry.root), ("repo", str(linker)))

    def test_a_symlinked_features_home_is_walked_from_its_real_path(self):
        real_features = self.root / "features"
        checklist = self._write(real_features / "proj" / "feat" / "checklist.md", "# Feat\n")
        os.symlink(real_features, self.features)

        entry = self._discover()[str(checklist)]

        self.assertEqual((entry.kind, entry.root), ("feature", str(real_features / "proj")))
        self.assertEqual(entry.walked, ())

    def test_ignored_repo_yields_no_entries(self):
        ignored = self._repo(self.dev / "old" / "x")
        self._write(ignored / "AGENTS.md")
        self._write(ignored / "nested" / "AGENTS.md")
        self.ignore = [f"{self.dev}/old/*"]

        entries = self._discover()

        under_ignored = [e.id for e in entries.values() if e.path.startswith(str(ignored) + os.sep)]
        self.assertEqual(under_ignored, [])

    def test_features_home_kinds(self):
        home = self.features / "proj"
        followups = self._write(home / "followups.md",
                                "**Contents**\n\n## First\nbody one\n\n## Second\nbody two\n")
        checklist = self._write(home / "feat" / "checklist.md", "# Feat\n- [ ] 01\n")
        task = self._write(home / "feat" / "01-a.md",
                           "# A\n\nStatus: in progress\n\n- [x] one\n- [ ] two\n")
        plan = self._write(home / "feat" / "plan-p" / "plan.md", "# Plan\n")

        entries = self._discover()

        followup_ids = {e.id for e in entries.values() if e.kind == "followup" and e.path == str(followups)}
        self.assertEqual(followup_ids, {f"{followups}#L3", f"{followups}#L6"})
        self.assertEqual(entries[str(checklist)].kind, "feature")
        self.assertEqual(entries[str(task)].kind, "task")
        self.assertEqual(entries[str(task)].meta["status"], "in progress")
        self.assertEqual(entries[str(task)].meta["checked"], 1)
        self.assertEqual(entries[str(task)].meta["total"], 2)
        self.assertEqual(entries[str(plan)].kind, "plan")
        self.assertEqual(entries[str(task)].repo, "proj")

    def test_settings_hooks_numbered_per_event(self):
        settings = self._write(self.home / ".claude" / "settings.json", json.dumps({"hooks": {
            "PreToolUse": [{"matcher": "Bash", "hooks": [
                {"type": "command", "command": "~/.claude/hooks/bash-lint --fix"},
                {"type": "command", "command": "/bin/echo hi"},
            ]}],
            "Stop": [{"hooks": [{"type": "command", "command": "notify"}]}],
        }}))

        entries = self._discover()

        self.assertIn(f"{settings}#hook:PreToolUse:0", entries)
        self.assertIn(f"{settings}#hook:PreToolUse:1", entries)
        stop = entries[f"{settings}#hook:Stop:0"]
        self.assertIsNone(stop.meta["matcher"])
        self.assertEqual(stop.title, "Stop → notify")
        self.assertEqual(entries[f"{settings}#hook:PreToolUse:0"].title, "PreToolUse Bash → bash-lint")

    def test_followup_meta_holds_its_tags(self):
        followups = self._write(self.features / "proj" / "followups.md",
                                "- **Coins** — *agent-ready, needs review*: replace the sink\n")

        entries = self._discover()

        self.assertEqual(entries[f"{followups}#L1"].meta["tags"], ["agent-ready", "needs review"])

    def test_followup_line_counts_line_feeds_alone(self):
        followups = self.features / "proj" / "followups.md"
        followups.parent.mkdir(parents=True)
        followups.write_bytes(b"- One\rstill one\n- Two\n")

        entries = self._discover()

        self.assertEqual({e.line for e in entries.values() if e.path == str(followups)}, {1, 2})

    def test_repo_followup_topic_file_has_no_tags(self):
        repo = self._repo(self.dev / "r")
        topic = self._write(repo / "docs" / "followups" / "queue.md",
                            "# Queue\n\n- **Coins** — *agent-ready*: replace the sink\n")

        entries = self._discover()

        self.assertEqual(entries[f"{topic}#L1"].meta["tags"], [])

    def test_repo_followup_gist_keeps_a_form_feed_and_a_lone_carriage_return_inside_its_line(self):
        repo = self._repo(self.dev / "r")
        topic = repo / "docs" / "followups" / "queue.md"
        topic.parent.mkdir(parents=True)
        topic.write_bytes(b"# Queue\n\nReplace\x0cthe\rsink\n")

        entries = self._discover()

        self.assertEqual(entries[f"{topic}#L1"].meta["gist"], "Replace\x0cthe\rsink")

    def test_a_doc_title_and_front_matter_read_a_lone_carriage_return_as_text(self):
        rows = [
            (Path("r") / "AGENTS.md", b"# One\rtwo\n", "One\rtwo"),
            (Path("r") / ".agents" / "skills" / "s" / "SKILL.md", b"---\nname: a\rb\n---\n", "a\rb"),
        ]
        self._repo(self.dev / "r")
        for relative, content, title in rows:
            with self.subTest(path=str(relative)):
                path = self.dev / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(content)

                entries = self._discover()

                self.assertEqual(entries[str(path)].title, title)

    def test_followups_readme_is_a_feature_doc(self):
        readme = self._write(self.features / "proj" / "followups" / "README.md")
        self._write(self.features / "proj" / "followups" / "a.md", "- Item one. detail\n")

        entries = self._discover()

        self.assertEqual(entries[str(readme)].kind, "feature-doc")
        followup_paths = {e.path for e in entries.values() if e.kind == "followup"}
        self.assertNotIn(str(readme), followup_paths)

    def test_in_repo_features_home_kinds(self):
        repo = self._repo(self.dev / "folder-name")
        subprocess.run(["git", "-C", str(repo), "remote", "add", "origin", "git@host:me/origin-name.git"],
                       check=True, capture_output=True)
        home = repo / "docs" / "features"
        checklist = self._write(home / "proj-feature" / "checklist.md", "# Feat\n- [ ] 01\n")
        plan = self._write(home / "proj-feature" / "plan-x" / "plan.md", "# Plan\n")
        task = self._write(home / "proj-feature" / "plan-x" / "01-a.md", "# A\n\nStatus: open\n")
        followups = self._write(home / "followups.md",
                                "**Contents**\n\n## First\nbody one\n\n## Second\nbody two\n")
        readme = self._write(home / "followups" / "README.md")

        entries = self._discover()

        expected_kinds = {
            str(checklist): "feature",
            str(plan): "plan",
            str(task): "task",
            f"{followups}#L3": "followup",
            f"{followups}#L6": "followup",
            str(readme): "feature-doc",
        }
        for entry_id, kind in expected_kinds.items():
            with self.subTest(entry=entry_id):
                entry = entries[entry_id]
                self.assertEqual((entry.kind, entry.source, entry.repo, entry.root),
                                 (kind, "features", "origin-name", str(home)))

    def test_in_repo_features_home_keeps_generated_folder_names(self):
        repo = self._repo(self.dev / "r")
        build = self._write(repo / "docs" / "features" / "build" / "checklist.md", "# Build\n")
        package = self._write(repo / "docs" / "features" / "node_modules" / "x.md")

        entries = self._discover()

        self.assertEqual(entries[str(build)].kind, "feature")
        self.assertNotIn(str(package), entries)

    def test_discover_folder_reaches_the_in_repo_features_home(self):
        repo = self._repo(self.dev / "r")
        checklist = self._write(repo / "docs" / "features" / "feat" / "checklist.md", "# Feat\n")
        folder = repo / "src"
        folder.mkdir()

        entries = {entry.id: entry for entry in discover_folder(self.env, self._config(), self.contributions, folder).entries}

        self.assertEqual(entries[str(checklist)].kind, "feature")

    def test_in_repo_features_home_follows_a_linked_folder(self):
        repo = self._repo(self.dev / "r")
        checklist = self._write(self.root / "shared" / "feat" / "checklist.md", "# Feat\n")
        (repo / "docs" / "features").mkdir(parents=True)
        os.symlink(checklist.parent, repo / "docs" / "features" / "feat")

        entries = self._discover()

        self.assertEqual(entries[str(checklist)].kind, "feature")

    def test_a_linked_docs_features_is_not_a_feature_home(self):
        repo = self._repo(self.dev / "r")
        shared = self.root / "shared"
        checklist = self._write(shared / "feat" / "checklist.md", "# Feat\n")
        (repo / "docs").mkdir()
        os.symlink(shared, repo / "docs" / "features")

        self.assertNotIn(str(checklist), self._discover())

    def test_a_linked_docs_holding_features_is_not_a_feature_home(self):
        repo = self._repo(self.dev / "r")
        shared_docs = self.root / "shared-docs"
        checklist = self._write(shared_docs / "features" / "feat" / "checklist.md", "# Feat\n")
        os.symlink(shared_docs, repo / "docs")

        self.assertNotIn(str(checklist), self._discover())

    def test_a_docs_features_holding_git_is_its_own_repo_not_a_feature_home(self):
        repo = self._repo(self.dev / "r")
        home = self._repo(repo / "docs" / "features")
        checklist = self._write(home / "feat" / "checklist.md", "# Feat\n")

        discovery = discover(self.env, self._config(), self.contributions)

        feature_ids = {entry.id for entry in discovery.entries if entry.source == "features"}
        self.assertNotIn(str(checklist), feature_ids)
        self.assertIn(str(home), discovery.repo_names)

    def test_a_docs_holding_git_is_its_own_repo_not_a_feature_home(self):
        repo = self._repo(self.dev / "r")
        docs = self._repo(repo / "docs")
        checklist = self._write(docs / "features" / "feat" / "checklist.md", "# Feat\n")

        discovery = discover(self.env, self._config(), self.contributions)

        feature_ids = {entry.id for entry in discovery.entries if entry.source == "features"}
        self.assertNotIn(str(checklist), feature_ids)
        self.assertIn(str(docs), discovery.repo_names)

    def test_a_linked_docs_features_in_a_repo_under_a_claude_folder_is_not_a_feature_home(self):
        outer = self._repo(self.dev / "outer")
        inner = self._repo(outer / ".claude" / "skills" / "x")
        shared = self.root / "shared"
        self._write(shared / "feat" / "checklist.md", "# Feat\n")
        (inner / "docs").mkdir()
        os.symlink(shared, inner / "docs" / "features")

        discovery = discover(self.env, self._config(), self.contributions)

        feature_sources = [entry.id for entry in discovery.entries if entry.source == "features"]
        self.assertEqual(feature_sources, [])

    def test_a_repo_under_a_claude_folder_prunes_its_generated_folders_and_skips_its_links(self):
        outer = self._repo(self.dev / "outer")
        inner = self._repo(outer / ".claude" / "skills" / "x")
        inner_agents = self._write(inner / "AGENTS.md")
        generated = self._write(inner / "build" / "AGENTS.md")
        shared = self.root / "shared"
        linked_agents = self._write(shared / "AGENTS.md")
        os.symlink(shared, inner / "linked")

        entries = self._discover()

        self.assertIn(str(inner_agents), entries)
        self.assertNotIn(str(generated), entries)
        self.assertNotIn(str(linked_agents), entries)

    def test_in_repo_features_home_keeps_instruction_files(self):
        repo = self._repo(self.dev / "r")
        agents = self._write(repo / "docs" / "features" / "AGENTS.md")

        entry = self._discover()[str(agents)]

        self.assertEqual((entry.kind, entry.source, entry.root), ("instructions", "repo", str(repo)))

    def test_a_project_folders_features_home_is_named_for_the_folder(self):
        repo = self._repo(self.dev / "r")
        self._write(repo / "proj" / "AGENTS.md")
        home = repo / "proj" / "docs" / "features"
        checklist = self._write(home / "feat" / "checklist.md", "# Feat\n")
        task = self._write(home / "feat" / "plan-x" / "01-a.md", "# A\n\nStatus: open\n")
        followups = self._write(home / "followups.md", "**Contents**\n\n## First\nbody one\n")
        root_checklist = self._write(repo / "docs" / "features" / "root-feat" / "checklist.md", "# Root\n")

        discovery = discover(self.env, self._config(), self.contributions)
        entries = {entry.id: entry for entry in discovery.entries}

        expected = {
            str(checklist): ("feature", "proj", str(home)),
            str(task): ("task", "proj", str(home)),
            f"{followups}#L3": ("followup", "proj", str(home)),
            str(root_checklist): ("feature", "r", str(repo / "docs" / "features")),
        }
        for entry_id, (kind, repo_name, root) in expected.items():
            with self.subTest(entry=entry_id):
                entry = entries[entry_id]
                self.assertEqual((entry.kind, entry.source, entry.repo, entry.root),
                                 (kind, "features", repo_name, root))
        self.assertEqual(discovery.in_repo_feature_homes[str(home)], str(repo))

    def test_a_folder_without_agents_md_or_below_the_top_has_no_features_home(self):
        repo = self._repo(self.dev / "r")
        plain = self._write(repo / "plain" / "docs" / "features" / "feat" / "checklist.md", "# Feat\n")
        self._write(repo / "outer" / "proj" / "AGENTS.md")
        deep = self._write(repo / "outer" / "proj" / "docs" / "features" / "feat" / "checklist.md", "# Feat\n")

        entries = self._discover()

        self.assertNotIn(str(plain), entries)
        self.assertNotIn(str(deep), entries)

    def test_a_linked_project_docs_features_is_not_a_feature_home(self):
        repo = self._repo(self.dev / "r")
        self._write(repo / "proj" / "AGENTS.md")
        shared = self.root / "shared"
        checklist = self._write(shared / "feat" / "checklist.md", "# Feat\n")
        (repo / "proj" / "docs").mkdir()
        os.symlink(shared, repo / "proj" / "docs" / "features")

        self.assertNotIn(str(checklist), self._discover())

    def test_docs_features_below_the_repo_root_is_not_a_home(self):
        repo = self._repo(self.dev / "r")
        checklist = self._write(repo / "sub" / "docs" / "features" / "checklist.md", "# Feat\n")

        entries = self._discover()

        self.assertNotIn(str(checklist), entries)

    def test_file_outside_any_repo_is_skipped(self):
        loose = self._write(self.dev / "notes" / "AGENTS.md")

        entries = self._discover()

        self.assertNotIn(str(loose), {e.path for e in entries.values()})

    def test_plugin_installed_at_two_scopes_is_one_entry(self):
        install = self.root / "cache" / "m" / "p" / "1.0.0"
        skill = self._write(install / "skills" / "k" / "SKILL.md", "---\nname: k\n---\n")
        self._write(self.home / ".claude" / "plugins" / "installed_plugins.json", json.dumps({"plugins": {
            "p@m": [
                {"scope": "user", "installPath": str(install), "version": "1.0.0"},
                {"scope": "project", "projectPath": str(self.dev), "installPath": str(install), "version": "1.0.0"},
            ],
        }}))

        entries = self._discover()

        plugin = entries[str(install)]
        self.assertEqual(plugin.kind, "plugin")
        self.assertEqual([i["scope"] for i in plugin.meta["installs"]], ["user", "project"])
        plugin_skills = {e.id for e in entries.values() if e.kind == "skill" and e.plugin == "p@m"}
        self.assertEqual(plugin_skills, {str(skill)})

    def test_discover_folder_walks_every_repo_holding_the_folder(self):
        repo = self._repo(self.dev / "r")
        repo_agents = self._write(repo / "AGENTS.md")
        sub = self._repo(repo / "sub")
        sub_agents = self._write(sub / "AGENTS.md")
        folder = sub / "deeper"
        folder.mkdir()
        other = self._repo(self.dev / "other")
        other_agents = self._write(other / "AGENTS.md")

        discovery = discover_folder(self.env, self._config(), self.contributions, folder)

        ids = {entry.id for entry in discovery.entries}
        self.assertIn(str(repo_agents), ids)
        self.assertIn(str(sub_agents), ids)
        self.assertNotIn(str(other_agents), ids)
        self.assertEqual(discovery.context_folders, [folder])

    def test_discover_folder_in_no_repo_walks_the_repos_below_it(self):
        group = self.dev / "group"
        below = self._write(self._repo(group / "r") / "AGENTS.md")
        beside = self._write(self._repo(self.dev / "other") / "AGENTS.md")

        in_group = {entry.id for entry in discover_folder(self.env, self._config(), self.contributions, group).entries}
        above_root = {entry.id for entry in discover_folder(self.env, self._config(), self.contributions, self.root).entries}

        self.assertIn(str(below), in_group)
        self.assertNotIn(str(beside), in_group)
        self.assertLessEqual({str(below), str(beside)}, above_root)

    def test_a_per_skill_link_is_exported_as_a_walked_path(self):
        repo = self._repo(self.dev / "r")
        skill = self._write(repo / ".agents" / "skills" / "s" / "SKILL.md", "---\nname: s\n---\n")
        (repo / ".claude" / "skills").mkdir(parents=True)
        os.symlink("../../.agents/skills/s", repo / ".claude" / "skills" / "s")

        entry = self._discover()[str(skill)]

        self.assertEqual(entry.to_json()["walked"], [str(repo / ".claude" / "skills" / "s" / "SKILL.md")])

    def test_a_symlinked_user_claude_md_keeps_its_link_location(self):
        dotfiles = self._write(self.root / "dotfiles" / "CLAUDE.md")
        (self.home / ".claude").mkdir()
        os.symlink(dotfiles, self.home / ".claude" / "CLAUDE.md")

        entry = self._discover()[str(dotfiles)]

        self.assertEqual([location.path for location in entry.walked], [str(self.home / ".claude" / "CLAUDE.md")])

    def test_generated_folder_names_are_kept_inside_agent_folders_and_feature_homes(self):
        repo = self._repo(self.dev / "r")
        claude_skill = self._write(repo / ".claude" / "skills" / "build" / "SKILL.md", "---\nname: build\n---\n")
        agents_skill = self._write(repo / ".agents" / "skills" / "dist" / "SKILL.md", "---\nname: dist\n---\n")
        command = self._write(repo / ".claude" / "commands" / "out" / "ship.md")
        generated = self._write(repo / "build" / "AGENTS.md")
        feature = self._write(self.features / "r" / "build" / "checklist.md", "# Build\n")

        entries = self._discover()

        for kept in (claude_skill, agents_skill, command, feature):
            self.assertIn(str(kept), entries)
        self.assertNotIn(str(generated), entries)

    def test_wigley_agents_archives_are_skipped_by_the_global_and_repo_walks(self):
        clone = self._repo(self.dev / "personal" / "wigley-agents")
        os.symlink(clone, self.home / "wigley-agents")
        kept = self._write(clone / "learning" / "current.md")
        archived_learning = self._write(clone / "learning" / "archive" / "old.md")
        archived = self._write(clone / "archive" / "AGENTS.md")

        entries = self._discover()

        self.assertIn(str(kept), entries)
        self.assertNotIn(str(archived_learning), entries)
        self.assertNotIn(str(archived), entries)

    def test_no_contributions_lists_no_features_home(self):
        self.contributions = Contributions()
        repo = self._repo(self.dev / "r")
        in_repo = self._write(repo / "docs" / "features" / "feat" / "checklist.md", "# Feat\n")
        out_of_repo = self._write(self.features / "r" / "feat" / "checklist.md", "# Feat\n")
        global_agents = self._write(self.home / "wigley-agents" / "AGENTS.md")

        discovery = discover(self.env, self._config(), self.contributions)

        ids = {entry.id for entry in discovery.entries}
        self.assertEqual(discovery.in_repo_feature_homes, {})
        self.assertEqual([entry.id for entry in discovery.entries if entry.source == "features"], [])
        self.assertNotIn(str(out_of_repo), ids)
        self.assertNotIn(str(global_agents), ids)
        self.assertNotIn(str(in_repo), ids)

    def test_reference_files_index_as_reference(self):
        notes = self.home / "notes"
        self.contributions = Contributions(global_folders=[GlobalFolder(path=notes, reference_files=("index.md",))])
        reference = self._write(notes / "index.md")
        instructions = self._write(notes / "rules.md")

        entries = self._discover()

        self.assertEqual([entries[str(path)].kind for path in (reference, instructions)], ["reference", "instructions"])

    def test_learning_subfolder_takes_learning_kind(self):
        notes = self.home / "notes"
        self.contributions = Contributions(
            global_folders=[GlobalFolder(path=notes, subfolders=("journal/learning", "pages"))])
        learning = self._write(notes / "journal" / "learning" / "lesson.md")
        page = self._write(notes / "pages" / "deep" / "page.md")

        entries = self._discover()

        self.assertEqual([(entries[str(path)].kind, entries[str(path)].source) for path in (learning, page)],
                         [("learning", "global"), ("reference", "global")])

    def test_skip_folder_is_not_walked(self):
        notes = self.home / "notes"
        self.contributions = Contributions(
            global_folders=[GlobalFolder(path=notes, subfolders=("pages",), skip=("pages/old",))])
        kept = self._write(notes / "pages" / "new.md")
        skipped = self._write(notes / "pages" / "old" / "gone.md")
        other_old = self._write(notes / "pages" / "keep" / "old" / "kept.md")

        entries = self._discover()

        self.assertIn(str(kept), entries)
        self.assertIn(str(other_old), entries)
        self.assertNotIn(str(skipped), entries)

    def test_custom_in_repo_template_is_a_home(self):
        self.contributions = self._contributions(in_repo_parts=(("notes", "todo"),))
        repo = self._repo(self.dev / "r")
        custom = self._write(repo / "notes" / "todo" / "feat" / "checklist.md", "# Feat\n")
        default = self._write(repo / "docs" / "features" / "other" / "checklist.md", "# Other\n")

        discovery = discover(self.env, self._config(), self.contributions)

        entries = {entry.id: entry for entry in discovery.entries}
        self.assertEqual((entries[str(custom)].kind, entries[str(custom)].source), ("feature", "features"))
        self.assertEqual(discovery.in_repo_feature_homes, {str(repo / "notes" / "todo"): str(repo)})
        self.assertNotIn(str(default), entries)

    def test_custom_file_and_area_folder(self):
        self.contributions = self._contributions(file="todo.md", area_folder="areas")
        home = self.features / "proj"
        todo = self._write(home / "todo.md", "- Item one. detail\n")
        area = self._write(home / "areas" / "ui.md", "- Item two. detail\n")
        old_file = self._write(home / "followups.md", "- Item three. detail\n")
        old_area = self._write(home / "followups" / "ui.md", "- Item four. detail\n")

        entries = self._discover()

        kinds = {path: {entry.kind for entry in entries.values() if entry.path == str(path)}
                 for path in (todo, area, old_file, old_area)}
        self.assertEqual(kinds, {todo: {"followup"}, area: {"followup"}, old_file: {"feature-doc"},
                                 old_area: {"feature-doc"}})

    def test_wigley_agents_decisions_file_is_reference(self):
        decisions = self._write(self.home / "wigley-agents" / "decisions.md")
        agents = self._write(self.home / "wigley-agents" / "AGENTS.md")

        entries = self._discover()

        self.assertEqual([entry.kind for entry in entries.values() if entry.path == str(decisions)],
                         ["reference"])
        self.assertEqual([entry.kind for entry in entries.values() if entry.path == str(agents)],
                         ["instructions"])

    def test_wigley_agents_wiki_files_are_global_reference(self):
        clone = self._repo(self.dev / "personal" / "wigley-agents")
        os.symlink(clone, self.home / "wigley-agents")
        main_page = self._write(clone / "wiki" / "Main.md")
        nested_page = self._write(clone / "wiki" / "sub" / "page.md")

        entries = self._discover()

        for page in (main_page, nested_page):
            with self.subTest(page=page.name):
                self.assertEqual((entries[str(page)].kind, entries[str(page)].source), ("reference", "global"))

    def test_wigley_agents_decisions_folder_is_not_indexed(self):
        old = self._write(self.home / "wigley-agents" / "decisions" / "old.md")

        entries = self._discover()

        self.assertEqual([entry.id for entry in entries.values() if entry.path == str(old)], [])

    def test_discover_folder_in_an_ignored_repo_indexes_none_of_its_files(self):
        ignored = self._repo(self.dev / "old")
        agents = self._write(ignored / "AGENTS.md")
        folder = ignored / "a"
        folder_agents = self._write(folder / "AGENTS.md")
        self.ignore = [str(ignored)]

        discovery = discover_folder(self.env, self._config(), self.contributions, folder)

        ids = {entry.id for entry in discovery.entries}
        self.assertNotIn(str(agents), ids)
        self.assertNotIn(str(folder_agents), ids)

    def test_a_symlinked_claude_folder_skips_its_worktrees(self):
        repo = self._repo(self.dev / "r")
        shared = self.root / "shared" / "claude"
        skill = self._write(shared / "skills" / "s" / "SKILL.md", "---\nname: s\n---\n")
        worktree_agents = self._write(shared / "worktrees" / "w" / "AGENTS.md")
        os.symlink(shared, repo / ".claude")

        entries = self._discover()

        self.assertIn(str(skill), entries)
        self.assertNotIn(str(worktree_agents), entries)

    def test_node_modules_is_skipped_inside_agent_folders_linked_folders_and_feature_homes(self):
        repo = self._repo(self.dev / "r")
        claude_package = self._write(repo / ".claude" / "skills" / "s" / "node_modules" / "p" / "CLAUDE.md")
        agents_package = self._write(repo / ".agents" / "skills" / "t" / "node_modules" / "p" / "AGENTS.md")
        linked = self.root / "shared" / "skills"
        linked_package = self._write(linked / "u" / "node_modules" / "p" / "CLAUDE.md")
        os.symlink(linked, repo / ".claude" / "commands")
        feature_package = self._write(self.features / "r" / "f" / "node_modules" / "p" / "README.md")

        entries = self._discover()

        for skipped in (claude_package, agents_package, linked_package, feature_package):
            self.assertNotIn(str(skipped), entries)

    def test_an_import_into_a_features_home_is_owned_by_the_home(self):
        home = self.features / "proj"
        imported = self._write(home / "shared.txt", "shared\n")
        self._write(self.home / ".claude" / "CLAUDE.md", "@~/wigley-features/proj/shared.txt\n")

        entry = self._discover()[str(imported)]

        self.assertEqual((entry.kind, entry.source, entry.repo, entry.root),
                         ("instructions", "features", "proj", str(home)))

    def test_an_import_into_an_ignored_repo_adds_no_entry(self):
        ignored = self._repo(self.dev / "old")
        imported = self._write(ignored / "notes.md")
        self._write(self.home / ".claude" / "CLAUDE.md", f"@{imported}\n")
        self.ignore = [str(ignored)]

        entries = self._discover()

        self.assertNotIn(str(imported), entries)

    def test_repo_walk_checks_only_a_listed_git_file_for_a_repo_root(self):
        repo = self._repo(self.dev / "r")
        self._write(repo / "a" / "b" / "AGENTS.md")
        submodule = self.dev / "r" / "sub"
        self._write(submodule / ".git", "gitdir: ../.git/modules/sub\n")
        self._write(submodule / "AGENTS.md")

        with mock.patch("discover.is_repo_root", wraps=is_repo_root) as checked:
            discovery = discover(self.env, self._config(), self.contributions)

        self.assertEqual({call.args[0] for call in checked.call_args_list}, {submodule})
        self.assertEqual(set(discovery.repo_names), {str(repo), str(submodule)})

    def test_a_folder_holding_a_dangling_git_link_is_not_a_repo_root(self):
        repo = self._repo(self.dev / "r")
        folder = repo / "f"
        folder.mkdir()
        os.symlink(self.root / "missing" / ".git", folder / ".git")
        agents = self._write(folder / "AGENTS.md")

        discovery = discover(self.env, self._config(), self.contributions)

        self.assertNotIn(str(folder), discovery.repo_names)
        entry = next(entry for entry in discovery.entries if entry.id == str(agents))
        self.assertEqual(entry.root, str(repo))

    def test_a_linked_worktree_yields_no_entries_in_build_or_folder_discovery(self):
        repo = self._repo(self.dev / "r")
        repo_checklist = self._write(repo / "docs" / "features" / "feat" / "checklist.md")
        worktree_git = repo / ".git" / "worktrees" / "r-build"
        self._write(worktree_git / "commondir", "../..\n")
        worktree = self.dev / ".r-build"
        self._write(worktree / ".git", f"gitdir: {worktree_git}\n")
        self._write(worktree / "AGENTS.md")
        self._write(worktree / "docs" / "features" / "feat" / "checklist.md")

        discovery = discover(self.env, self._config(), self.contributions)
        folder_discovery = discover_folder(self.env, self._config(), self.contributions, worktree / "docs")

        for found in (discovery, folder_discovery):
            under_worktree = [entry.id for entry in found.entries if entry.path.startswith(str(worktree) + os.sep)]
            self.assertEqual(under_worktree, [])
            self.assertNotIn(str(worktree), found.repo_names)
        self.assertIn(str(repo_checklist), {entry.id for entry in discovery.entries})
        self.assertEqual(set(discovery.in_repo_feature_homes.values()), {str(repo)})

    def test_a_submodule_git_file_is_still_a_repo_with_its_features_home(self):
        repo = self._repo(self.dev / "r")
        self._write(repo / ".git" / "modules" / "sub" / "HEAD", "ref: refs/heads/main\n")
        submodule = repo / "sub"
        self._write(submodule / ".git", "gitdir: ../.git/modules/sub\n")
        agents = self._write(submodule / "AGENTS.md")
        checklist = self._write(submodule / "docs" / "features" / "feat" / "checklist.md")

        discovery = discover(self.env, self._config(), self.contributions)

        entries = {entry.id: entry for entry in discovery.entries}
        self.assertEqual(entries[str(agents)].root, str(submodule))
        self.assertEqual(entries[str(checklist)].kind, "feature")
        self.assertEqual(discovery.in_repo_feature_homes[str(submodule / "docs" / "features")], str(submodule))


    def _discover_two_folders(self, *config_dirs):
        env = Environment(home=self.home, now=lambda: FIXED_NOW, claude_config_dirs=config_dirs)
        return {entry.id: entry for entry in discover(env, self._config(), self.contributions).entries}

    def test_every_claude_config_dir_is_walked_as_global(self):
        personal, claude = self.home / ".claude-personal", self.home / ".claude"
        claude_md = self._write(claude / "CLAUDE.md")
        kinds = {
            self._write(personal / "CLAUDE.md"): "instructions",
            self._write(personal / "rules" / "r.md"): "rule",
            self._write(personal / "skills" / "s" / "SKILL.md", "---\nname: s\n---\n"): "skill",
            self._write(personal / "skills" / "synced" / "b" / "t" / "SKILL.md", "---\nname: t\n---\n"): "skill",
            self._write(personal / "agents" / "a.md"): "subagent",
            self._write(personal / "commands" / "c.md"): "command",
            claude_md: "instructions",
        }
        self._write(personal / "settings.json", json.dumps(
            {"hooks": {"Stop": [{"hooks": [{"type": "command", "command": "say done"}]}]}}))

        entries = self._discover_two_folders(claude, personal)

        hook_id = f"{personal}/settings.json#hook:Stop:0"
        self.assertEqual(entries[hook_id].kind, "hook")
        for path, kind in kinds.items():
            with self.subTest(path=path):
                self.assertEqual(entries[os.path.realpath(path)].kind, kind)
        for entry_id in [*(os.path.realpath(path) for path in kinds), hook_id]:
            self.assertEqual(entries[entry_id].source, "global")

    def test_a_plugin_listed_by_two_config_dirs_is_one_entry_with_each_install_once(self):
        personal, claude = self.home / ".claude-personal", self.home / ".claude"
        p = self.root / "cache" / "m" / "p" / "1.0.0"
        q = self.root / "cache" / "m" / "q" / "1.0.0"
        for install in (p, q):
            self._write(install / "skills" / "k" / "SKILL.md", "---\nname: k\n---\n")
        p_record = {"scope": "user", "installPath": str(p), "version": "1.0.0"}
        q_record = {"scope": "user", "installPath": str(q), "version": "1.0.0"}
        self._write(claude / "plugins" / "installed_plugins.json", json.dumps({"plugins": {"p@m": [p_record]}}))
        self._write(personal / "plugins" / "installed_plugins.json",
                    json.dumps({"plugins": {"p@m": [p_record], "q@m": [q_record]}}))

        entries = self._discover_two_folders(claude, personal)

        self.assertEqual(entries[str(p)].meta["installs"], [{"scope": "user", "projectPath": None}])
        self.assertEqual(entries[str(q)].kind, "plugin")
        self.assertEqual(entries[str(q)].plugin, "q@m")

    def _marketplace_clone(self, path, name="mkt", plugin="p"):
        """A marketplace clone at path, origin git@github-personal:Me/Mkt.git,
        listing plugin from ./plugins/<plugin> with skill k (SKILL.md, ref.md)
        and one Stop hook; the clone."""
        clone = self._repo(path)
        subprocess.run(["git", "-C", str(clone), "remote", "add", "origin", "git@github-personal:Me/Mkt.git"],
                       check=True, capture_output=True)
        self._write(clone / ".claude-plugin" / "marketplace.json",
                    json.dumps({"name": name, "plugins": [{"name": plugin, "source": f"./plugins/{plugin}"}]}))
        self._plugin_files(clone / "plugins" / plugin, "ref.md")
        return clone

    def _plugin_files(self, folder, *other_skill_files):
        self._write(folder / "skills" / "k" / "SKILL.md", "---\nname: k\n---\n")
        for name in other_skill_files:
            self._write(folder / "skills" / "k" / name)
        self._write(folder / "hooks" / "hooks.json",
                    json.dumps({"hooks": {"Stop": [{"hooks": [{"type": "command", "command": "notify"}]}]}}))

    def _claude_install(self, key="p@mkt", url="https://github.com/me/mkt"):
        """key installed for the user at <tmp>/cache/<marketplace>/<plugin>/1.0.0
        with skill k (SKILL.md, ref.md, extra.md) and one Stop hook, its
        marketplace mkt at url; the install folder."""
        plugin, _, marketplace = key.partition("@")
        install = self.root / "cache" / marketplace / plugin / "1.0.0"
        self._plugin_files(install, "ref.md", "extra.md")
        self._write(self.home / ".claude" / "plugins" / "installed_plugins.json", json.dumps({"plugins": {
            key: [{"scope": "user", "installPath": str(install), "version": "1.0.0"}],
        }}))
        self._write(self.home / ".claude" / "plugins" / "known_marketplaces.json",
                    json.dumps({"mkt": {"source": {"source": "git", "url": url}}}))
        return install

    def test_an_installed_file_merges_into_its_clone_counterpart(self):
        clone = self._marketplace_clone(self.dev / "mkt")
        install = self._claude_install()
        install_skill = install / "skills" / "k" / "SKILL.md"

        entries = self._discover()

        install_files = (str(install_skill), str(install / "skills" / "k" / "ref.md"))
        self.assertEqual([entry_id for entry_id in entries if entry_id.startswith(install_files)], [])
        entry = entries[str(clone / "plugins" / "p" / "skills" / "k" / "SKILL.md")]
        self.assertEqual((entry.source, entry.repo, entry.root, entry.plugin, entry.ownership),
                         ("repo", "Mkt", str(clone), "p@mkt", "mine"))
        install_owner = Owner("plugin", root=str(install), plugin="p@mkt")
        self.assertEqual(entry.installed, (Installed(Location(str(install_skill), install_owner), "claude", "1.0.0"),))
        self.assertEqual(entry.to_json()["walked"], [])

    def test_an_installed_hook_merges_by_its_fragment(self):
        clone = self._marketplace_clone(self.dev / "mkt")
        install = self._claude_install()
        install_hooks = install / "hooks" / "hooks.json"

        entries = self._discover()

        entry = entries[f"{clone / 'plugins' / 'p' / 'hooks' / 'hooks.json'}#hook:Stop:0"]
        self.assertEqual([copy.location.path for copy in entry.installed], [str(install_hooks)])
        self.assertNotIn(f"{install_hooks}#hook:Stop:0", entries)

    def test_an_install_file_the_clone_lacks_stays_installed_only_and_mine(self):
        self._marketplace_clone(self.dev / "mkt")
        install = self._claude_install()

        entries = self._discover()

        extra = entries[str(install / "skills" / "k" / "extra.md")]
        self.assertEqual((extra.kind, extra.source, extra.ownership, extra.installed),
                         ("skill-file", "plugin", "mine", ()))
        plugin = entries[str(install)]
        self.assertEqual((plugin.kind, plugin.ownership), ("plugin", "mine"))

    def test_a_clone_file_with_no_install_has_no_installed_copy(self):
        clone = self._marketplace_clone(self.dev / "mkt")

        entry = self._discover()[str(clone / "plugins" / "p" / "skills" / "k" / "SKILL.md")]

        self.assertEqual(entry.installed, ())
        self.assertEqual(entry.to_json()["meta"]["installed"], [])

    def _assert_install_is_third_party(self, entries, install):
        install_ids = [str(install), str(install / "skills" / "k" / "SKILL.md"), str(install / "skills" / "k" / "ref.md"),
                       str(install / "skills" / "k" / "extra.md"), f"{install / 'hooks' / 'hooks.json'}#hook:Stop:0"]
        for entry_id in install_ids:
            with self.subTest(entry=entry_id):
                self.assertEqual((entries[entry_id].root, entries[entry_id].ownership), (str(install), "third-party"))

    def test_an_install_with_no_matching_clone_is_third_party(self):
        self._marketplace_clone(self.dev / "mkt")
        install = self._claude_install(url="https://github.com/other/mkt")

        self._assert_install_is_third_party(self._discover(), install)

    def test_an_install_whose_plugin_the_clone_does_not_list_is_third_party(self):
        self._marketplace_clone(self.dev / "mkt")
        install = self._claude_install(key="q@mkt")

        self._assert_install_is_third_party(self._discover(), install)

    def test_a_codex_install_merges_after_the_claude_install(self):
        clone = self._marketplace_clone(self.dev / "mkt")
        self._claude_install()
        self._write(self.home / ".codex" / "plugins" / "cache" / "mkt" / "p" / "2.0.0" / "skills" / "k" / "SKILL.md",
                    "---\nname: k\n---\n")
        self._write(self.home / ".codex" / "config.toml",
                    '[marketplaces.mkt]\nsource = "git@github-personal:Me/Mkt.git"\n')

        entry = self._discover()[str(clone / "plugins" / "p" / "skills" / "k" / "SKILL.md")]

        self.assertEqual([copy.harness for copy in entry.installed], ["claude", "codex"])
        self.assertEqual([copy.version for copy in entry.installed], ["1.0.0", "2.0.0"])

    def test_the_first_matching_clone_in_walk_order_is_the_source(self):
        first = self._marketplace_clone(self.dev / "a-mkt")
        second = self._marketplace_clone(self.dev / "b-mkt")
        install = self._claude_install()

        entries = self._discover()

        skill = Path("plugins") / "p" / "skills" / "k" / "SKILL.md"
        self.assertEqual([copy.location.path for copy in entries[str(first / skill)].installed],
                         [str(install / "skills" / "k" / "SKILL.md")])
        self.assertEqual(entries[str(second / skill)].installed, ())

    def test_a_clone_plugins_root_claude_md_is_one_entry(self):
        clone = self._marketplace_clone(self.dev / "mkt")
        claude_md = self._write(clone / "plugins" / "p" / "CLAUDE.md")

        entries = self._discover()

        matching = [entry for entry in entries.values() if entry.path == str(claude_md)]
        self.assertEqual([(entry.kind, entry.plugin, entry.root) for entry in matching],
                         [("instructions", "p@mkt", str(clone))])

    def test_repo_names_hold_no_plugin_folder(self):
        clone = self._marketplace_clone(self.dev / "mkt")

        discovery = discover(self.env, self._config(), self.contributions)

        self.assertEqual(set(discovery.repo_names), {str(clone)})

    def test_discover_folder_outside_the_clone_merges_installs(self):
        clone = self._marketplace_clone(self.dev / "mkt")
        self._claude_install()
        app = self._repo(self.dev / "app")

        entries = {entry.id: entry for entry in discover_folder(self.env, self._config(), self.contributions, app).entries}

        self.assertEqual(len(entries[str(clone / "plugins" / "p" / "skills" / "k" / "SKILL.md")].installed), 1)

    def test_the_clone_search_looks_no_deeper_than_a_clone(self):
        clone = self._marketplace_clone(self.dev / "mkt")
        self._marketplace_clone(clone / "inner", name="inner", plugin="q")
        scan = _Scan(self.env, self._config(), self.contributions)

        _walk_marketplace_clones(scan)

        self.assertEqual([found.root for found in scan.marketplace_clones], [str(clone)])

    def test_a_clone_outside_the_walked_repos_registers_as_a_repo(self):
        clone = self._marketplace_clone(self.dev / "mkt")
        scan = _Scan(self.env, self._config(), self.contributions)

        _walk_marketplace_clones(scan)

        repo = Owner("repo", repo="Mkt", root=str(clone))
        self.assertEqual((scan.repo_owners[str(clone)], scan.owner_roots[str(clone)]), (repo, repo))

    def test_skill_files_skip_skill_md_nul_files_and_generated_folders(self):
        skill = self._write(self.home / ".claude" / "skills" / "s" / "SKILL.md", "---\nname: s\n---\n")
        reference = self._write(skill.parent / "references" / "r.md")
        blob = skill.parent / "blob.bin"
        blob.write_bytes(b"a\x00b")
        self._write(skill.parent / "__pycache__" / "x.pyc")

        entries = self._discover()

        self.assertEqual({entry.id for entry in entries.values() if entry.kind == "skill-file"}, {str(reference)})
        entry = entries[str(reference)]
        self.assertEqual((entry.title, entry.meta, entry.source, entry.ownership),
                         ("references/r.md", {"skill": str(skill)}, "global", "mine"))

    def test_a_repo_agents_skill_has_skill_files_owned_by_the_repo(self):
        repo = self._repo(self.dev / "r")
        self._write(repo / ".agents" / "skills" / "s" / "SKILL.md", "---\nname: s\n---\n")
        notes = self._write(repo / ".agents" / "skills" / "s" / "notes.md")

        entry = self._discover()[str(notes)]

        self.assertEqual((entry.kind, entry.root), ("skill-file", str(repo)))

    def test_an_instruction_file_in_a_skill_folder_stays_instructions_in_repo_and_plugin_walks(self):
        repo = self._repo(self.dev / "r")
        self._write(repo / ".claude" / "skills" / "x" / "SKILL.md", "---\nname: x\n---\n")
        repo_agents = self._write(repo / ".claude" / "skills" / "x" / "AGENTS.md")
        install = self._claude_install()
        self._write(install / "skills" / "x" / "SKILL.md", "---\nname: x\n---\n")
        plugin_agents = self._write(install / "skills" / "x" / "AGENTS.md")

        entries = self._discover()

        self.assertEqual(entries[str(repo_agents)].kind, "instructions")
        self.assertEqual(entries[str(plugin_agents)].kind, "instructions")

    def test_a_synced_skill_and_its_files_are_third_party(self):
        skill = self._write(self.home / ".claude" / "skills" / "synced" / "anthropic" / "pdf" / "SKILL.md",
                            "---\nname: pdf\n---\n")
        forms = self._write(skill.parent / "forms.md")

        entries = self._discover()

        self.assertEqual([entries[str(path)].ownership for path in (skill, forms)], ["third-party", "third-party"])


if __name__ == "__main__":
    unittest.main()
