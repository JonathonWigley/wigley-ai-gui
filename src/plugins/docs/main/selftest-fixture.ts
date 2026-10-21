import type { Files } from '../../../contracts/files';
import type {
  IndexContext,
  IndexDocument,
  IndexEntry,
  LoadStateRecord,
} from '../contract';
import { joinPath } from '../doc-paths';
import { installedPluginsFile, WIGLEY_PLUGIN_KEY } from './script-locator';
import { MACHINE_INDEX_FILE } from './index-sources';

const FIXTURE_PLUGIN_KEY = 'selftest-plugin@selftest-market';
const KEPT_RULE = 'style.md';

// Writes the self-test's docs, index and stand-in docs_index.py under
// `homeDir` (the self-test's temp home), first removing what an earlier
// self-test run's steps added.
export async function writeDocsFixture(
  files: Files,
  homeDir: string,
): Promise<void> {
  const home = await files.realPath(homeDir);
  const paths = fixturePaths(home);
  for (const entry of await files.list(paths.rules)) {
    if (entry.path !== KEPT_RULE) {
      await files.trash(joinPath(paths.rules, entry.path));
    }
  }
  const index = indexDocument(paths);
  const writes: [string, string][] = [
    [
      paths.claudeMd,
      '# Self-test instructions\n\nSee [the style rule](rules/style.md) and [the web](https://example.com).\n\n## Second heading\n\nBack [to the top](#self-test-instructions).\n',
    ],
    [paths.styleRule, '# Style\n\nWrite short lines.\n'],
    [
      paths.settings,
      '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"lint"}]}]}}\n',
    ],
    [paths.repoAgentsMd, '# Repo instructions\n'],
    [
      paths.repoSkill,
      '---\nname: demo\ndescription: A self-test skill.\n---\n\n# Demo\n',
    ],
    [
      paths.pluginSkill,
      '---\nname: cached\ndescription: A plugin skill.\n---\n\n# Cached\n',
    ],
    [paths.followups, '# Follow-ups\n\n- **First follow-up** — waits.\n'],
    [installedPluginsFile(paths.claudeDir), installedPlugins(paths)],
    [joinPath(paths.scriptFolder, 'index.fixture.json'), json(index)],
    [
      joinPath(paths.scriptFolder, 'session.fixture.json'),
      json(sessionDocument(paths, index)),
    ],
    [joinPath(paths.scriptFolder, 'docs_index.py'), standInScript(home)],
  ];
  for (const [path, text] of writes) {
    await files.write(path, text);
  }
  // Last, so a reader never sees an index whose files are missing.
  await files.write(joinPath(home, MACHINE_INDEX_FILE), json(index));
}

type FixturePaths = ReturnType<typeof fixturePaths>;

function fixturePaths(home: string) {
  const claudeDir = joinPath(home, '.claude');
  const repo = joinPath(home, 'dev', 'selftest-repo');
  const pluginRoot = joinPath(
    claudeDir,
    'plugins/cache/selftest-market/selftest-plugin/1.0.0',
  );
  return {
    home,
    claudeDir,
    rules: joinPath(claudeDir, 'rules'),
    claudeMd: joinPath(claudeDir, 'CLAUDE.md'),
    styleRule: joinPath(claudeDir, 'rules', KEPT_RULE),
    settings: joinPath(claudeDir, 'settings.json'),
    repo,
    repoAgentsMd: joinPath(repo, 'AGENTS.md'),
    repoSkill: joinPath(repo, '.claude/skills/demo/SKILL.md'),
    pluginRoot,
    pluginSkill: joinPath(pluginRoot, 'skills/cached/SKILL.md'),
    featuresHome: joinPath(home, 'wigley-features', 'selftest-repo'),
    followups: joinPath(home, 'wigley-features/selftest-repo/followups.md'),
    wigleyInstall: joinPath(
      claudeDir,
      'plugins/cache/wigley-ai-marketplace/wigley/0.0.0',
    ),
    scriptFolder: joinPath(
      claudeDir,
      'plugins/cache/wigley-ai-marketplace/wigley/0.0.0/scripts/docs-index',
    ),
  };
}

// The plugin's key sits on line 3.
function installedPlugins(paths: FixturePaths): string {
  const install = (installPath: string) =>
    `[{"scope":"user","installPath":${JSON.stringify(installPath)}}]`;
  return (
    '{"version":2,"plugins":{\n' +
    `"${WIGLEY_PLUGIN_KEY}":${install(paths.wigleyInstall)},\n` +
    `"${FIXTURE_PLUGIN_KEY}":${install(paths.pluginRoot)}\n` +
    '}}\n'
  );
}

function entry(
  fields: Pick<IndexEntry, 'kind' | 'source' | 'path' | 'title' | 'meta'> &
    Partial<IndexEntry>,
): IndexEntry {
  return {
    id: fields.path,
    repo: null,
    root: null,
    plugin: null,
    line: null,
    ...fields,
  };
}

function state(
  claude: LoadStateRecord,
  codex?: LoadStateRecord,
): Partial<Record<'claude' | 'codex', LoadStateRecord>> {
  return codex === undefined ? { claude } : { claude, codex };
}

function indexDocument(paths: FixturePaths): IndexDocument {
  const repoOwned = { repo: 'selftest-repo', root: paths.repo };
  const pluginOwned = { root: paths.pluginRoot, plugin: FIXTURE_PLUGIN_KEY };
  const entries: IndexEntry[] = [
    entry({
      kind: 'instructions',
      source: 'global',
      path: paths.claudeMd,
      title: 'Self-test instructions',
      meta: { imports: [] },
    }),
    entry({
      kind: 'rule',
      source: 'global',
      path: paths.styleRule,
      title: 'Style',
      meta: { paths: [] },
    }),
    entry({
      id: `${paths.settings}#hook:PreToolUse:0`,
      kind: 'hook',
      source: 'global',
      path: paths.settings,
      title: 'PreToolUse Bash → lint',
      meta: { event: 'PreToolUse', matcher: 'Bash', command: 'lint' },
    }),
    entry({
      kind: 'plugin',
      source: 'plugin',
      ...pluginOwned,
      path: paths.pluginRoot,
      title: FIXTURE_PLUGIN_KEY,
      meta: {
        harness: 'claude',
        version: '1.0.0',
        installs: [{ scope: 'user', projectPath: null }],
      },
    }),
    entry({
      kind: 'instructions',
      source: 'repo',
      ...repoOwned,
      path: paths.repoAgentsMd,
      title: 'Repo instructions',
      meta: { imports: [] },
    }),
    entry({
      kind: 'skill',
      source: 'repo',
      ...repoOwned,
      path: paths.repoSkill,
      title: 'demo',
      meta: { name: 'demo', description: 'A self-test skill.' },
    }),
    entry({
      kind: 'skill',
      source: 'plugin',
      ...pluginOwned,
      path: paths.pluginSkill,
      title: 'cached',
      meta: { name: 'cached', description: 'A plugin skill.' },
    }),
    entry({
      id: `${paths.followups}#L3`,
      kind: 'followup',
      source: 'features',
      repo: 'selftest-repo',
      root: paths.featuresHome,
      path: paths.followups,
      line: 3,
      title: 'First follow-up',
      meta: { status: 'open', gist: 'waits.', section: null },
    }),
  ];
  const contexts: IndexContext[] = [
    {
      folder: paths.home,
      sessionId: null,
      states: {
        [paths.claudeMd]: state(
          { state: 'launch', reason: 'user CLAUDE.md' },
          { state: 'not-loaded', reason: 'Claude Code file' },
        ),
        [paths.styleRule]: state({
          state: 'launch',
          reason: 'rule without paths',
        }),
      },
    },
    {
      folder: paths.repo,
      sessionId: null,
      states: {
        [paths.repoAgentsMd]: state(
          { state: 'launch', reason: 'AGENTS.md in the folder' },
          { state: 'launch', reason: 'AGENTS.md in the folder' },
        ),
      },
    },
  ];
  return {
    schemaVersion: 1,
    generatedAt: '2026-10-19T00:00:00Z',
    entries,
    contexts,
  };
}

// The first, second, fifth and sixth machine entries, judged for one session
// in the repo.
function sessionDocument(
  paths: FixturePaths,
  index: IndexDocument,
): IndexDocument {
  const inTranscript = {
    state: 'launch',
    reason: 'in the transcript',
  } as const;
  return {
    ...index,
    entries: [0, 1, 4, 5].map((position) => index.entries[position]),
    contexts: [
      {
        folder: paths.repo,
        sessionId: 'selftest-session',
        states: {
          [paths.claudeMd]: state(inTranscript),
          [paths.repoAgentsMd]: state(inTranscript),
        },
      },
    ],
  };
}

function json(document: IndexDocument): string {
  return JSON.stringify(document, null, 2);
}

// `build` drops entries whose file is gone and lists each new `.md` in the
// rules folder as a global rule, so the self-test's changes there survive a
// background build. It never reads HOME: the temp home is a literal.
function standInScript(home: string): string {
  return `import json, os, sys
HOME = ${JSON.stringify(home)}
HERE = os.path.dirname(os.path.abspath(__file__))
def text(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as file:
        return file.read()
def built_index():
    doc = json.loads(text("index.fixture.json"))
    doc["entries"] = [entry for entry in doc["entries"] if os.path.exists(entry["path"])]
    known = {entry["path"] for entry in doc["entries"]}
    rules = os.path.join(HOME, ".claude", "rules")
    for name in sorted(os.listdir(rules)):
        path = os.path.join(rules, name)
        if name.endswith(".md") and path not in known:
            doc["entries"].append({"id": path, "kind": "rule", "source": "global", "repo": None,
                "root": None, "plugin": None, "path": path, "line": None, "title": name,
                "meta": {"paths": []}})
    doc["entries"].sort(key=lambda entry: entry["id"])
    return json.dumps(doc, indent=2)
command = sys.argv[1] if len(sys.argv) > 1 else ""
if command == "build":
    target = os.path.join(HOME, ".agents", "wigley-docs", "index.json")
    with open(target + ".tmp", "w", encoding="utf-8") as file:
        file.write(built_index())
    os.replace(target + ".tmp", target)
elif command in ("session", "context"):
    print(text("session.fixture.json"))
else:
    print("self-test docs_index.py: unknown command " + command, file=sys.stderr)
    sys.exit(2)
`;
}
