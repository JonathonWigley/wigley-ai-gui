import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import type {
  IndexContext,
  IndexDocument,
  IndexEntry,
  LoadStateRecord,
} from '../contract';
import { installedPluginsFile, WIGLEY_PLUGIN_KEY } from './script-locator';
import { MACHINE_INDEX_FILE } from './index-sources';

const FIXTURE_PLUGIN_KEY = 'selftest-plugin@selftest-market';
const VENDOR_PLUGIN_KEY = 'vendor-plugin@vendor-market';
// Makes CLAUDE.md several pages long, rendered and in the editor, so a
// half-page scroll moves it.
const LONG_SECTION = `\n## Long section\n\n${Array.from(
  { length: 80 },
  (_, index) => `Line ${index + 1}.\n`,
).join('\n')}`;
const KEPT_RULE = 'style.md';
// One global doc per index load state other than `launch`, each written to
// `<state>.md` in the load-states folder and judged for Claude only.
const LOAD_STATE_DOCS: readonly LoadStateRecord[] = [
  { state: 'on-demand', reason: 'loads when invoked' },
  { state: 'listed', reason: 'listed by name only' },
  { state: 'shadowed', reason: 'a nearer file wins' },
  { state: 'not-loaded', reason: 'not read at launch' },
];

export interface DocsFixtureOptions {
  // Adds the `LOAD_STATE_DOCS` docs under `.claude/load-states/` and their
  // states in the home folder's context.
  loadStates: boolean;
  // Milliseconds the stand-in docs_index.py waits before answering any
  // command, so the index run an in-app change starts outlasts the Docs
  // tree's pending chip. 0 or absent answers at once.
  indexDelayMs?: number;
}

// Writes the self-test's docs, index and stand-in docs_index.py under
// `homeDir` (the self-test's temp home), then removes what an earlier
// self-test run's steps added, and the load-states folder when
// `options.loadStates` is off.
export async function writeDocsFixture(
  files: Files,
  homeDir: string,
  paths: Paths,
  options: DocsFixtureOptions = { loadStates: false },
): Promise<void> {
  const home = await files.realPath(homeDir);
  const fixture = fixturePaths(home, paths);
  const index = indexDocument(fixture, options, paths);
  const writes: [string, string][] = [
    [
      fixture.claudeMd,
      '# Self-test instructions\n\nSee [the style rule](rules/style.md) and [the web](https://example.com).\n\n## Second heading\n\nBack [to the top](#self-test-instructions).\n' +
        LONG_SECTION,
    ],
    [fixture.styleRule, '# Style\n\nWrite short lines.\n'],
    [
      fixture.settings,
      '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"lint"}]}]}}\n',
    ],
    [fixture.repoAgentsMd, '# Repo instructions\n'],
    [
      fixture.repoSkill,
      '---\nname: demo\ndescription: A self-test skill.\n---\n\n# Demo\n',
    ],
    [
      fixture.pluginSkill,
      '---\nname: cached\ndescription: A plugin skill.\n---\n\n# Cached\n',
    ],
    [fixture.followups, '# Follow-ups\n\n- **First follow-up** — waits.\n'],
    [
      fixture.syncedSkill,
      '---\nname: synced-demo\ndescription: A synced skill.\n---\n\n# Synced demo\n',
    ],
    [
      fixture.vendorSkill,
      '---\nname: vendored\ndescription: A third-party plugin skill.\n---\n\n# Vendored\n',
    ],
    ...loadStateDocs(options, fixture, paths).map((doc): [string, string] => [
      doc.path,
      `# ${doc.title}\n`,
    ]),
    [installedPluginsFile(fixture.claudeDir, paths), installedPlugins(fixture)],
    [paths.join(fixture.scriptFolder, 'index.fixture.json'), json(index)],
    [
      paths.join(fixture.scriptFolder, 'session.fixture.json'),
      json(sessionDocument(fixture, index)),
    ],
    [
      paths.join(fixture.scriptFolder, 'docs_index.py'),
      standInScript(home, options.indexDelayMs ?? 0),
    ],
  ];
  for (const [path, text] of writes) {
    await files.write(path, text);
  }
  // After the docs it lists are written and before the rules and load-state
  // docs it no longer lists are trashed, so a reader never sees an index whose
  // files are missing.
  await files.write(paths.join(home, MACHINE_INDEX_FILE), json(index));
  for (const entry of await files.list(fixture.rules)) {
    if (entry.path !== KEPT_RULE) {
      await files.trash(paths.join(fixture.rules, entry.path));
    }
  }
  const hasLoadStatesFolder = (await files.stat(fixture.loadStates)) !== null;
  if (!options.loadStates && hasLoadStatesFolder) {
    await files.trash(fixture.loadStates);
  }
}

type FixturePaths = ReturnType<typeof fixturePaths>;

function fixturePaths(home: string, paths: Paths) {
  const claudeDir = paths.join(home, '.claude');
  const repo = paths.join(home, 'dev', 'selftest-repo');
  const pluginRoot = paths.join(
    claudeDir,
    'plugins/cache/selftest-market/selftest-plugin/1.0.0',
  );
  const vendorRoot = paths.join(
    claudeDir,
    'plugins/cache/vendor-market/vendor-plugin/2.0.0',
  );
  return {
    home,
    claudeDir,
    rules: paths.join(claudeDir, 'rules'),
    loadStates: paths.join(claudeDir, 'load-states'),
    claudeMd: paths.join(claudeDir, 'CLAUDE.md'),
    styleRule: paths.join(claudeDir, 'rules', KEPT_RULE),
    settings: paths.join(claudeDir, 'settings.json'),
    repo,
    repoAgentsMd: paths.join(repo, 'AGENTS.md'),
    repoSkill: paths.join(repo, '.claude/skills/demo/SKILL.md'),
    pluginRoot,
    pluginSkill: paths.join(pluginRoot, 'skills/cached/SKILL.md'),
    syncedSkill: paths.join(
      claudeDir,
      'skills/synced/selftest-bucket/synced-demo/SKILL.md',
    ),
    vendorRoot,
    vendorSkill: paths.join(vendorRoot, 'skills/vendored/SKILL.md'),
    featuresHome: paths.join(home, 'wigley-features', 'selftest-repo'),
    followups: paths.join(home, 'wigley-features/selftest-repo/followups.md'),
    wigleyInstall: paths.join(
      claudeDir,
      'plugins/cache/wigley-ai-marketplace/wigley/0.0.0',
    ),
    scriptFolder: paths.join(
      claudeDir,
      'plugins/cache/wigley-ai-marketplace/wigley/0.0.0/scripts/docs-index',
    ),
  };
}

// The plugin's key sits on line 3.
function installedPlugins(fixture: FixturePaths): string {
  const install = (installPath: string) =>
    `[{"scope":"user","installPath":${JSON.stringify(installPath)}}]`;
  return (
    '{"version":2,"plugins":{\n' +
    `"${WIGLEY_PLUGIN_KEY}":${install(fixture.wigleyInstall)},\n` +
    `"${FIXTURE_PLUGIN_KEY}":${install(fixture.pluginRoot)}\n` +
    '}}\n'
  );
}

function entry(
  fields: Pick<IndexEntry, 'kind' | 'source' | 'path' | 'title' | 'meta'> &
    Partial<IndexEntry>,
): IndexEntry {
  return {
    id: fields.path,
    owner: 'mine',
    repo: null,
    root: null,
    plugin: null,
    line: null,
    walked: [],
    ...fields,
  };
}

function state(
  claude: LoadStateRecord,
  codex?: LoadStateRecord,
): Partial<Record<'claude' | 'codex', LoadStateRecord>> {
  return codex === undefined ? { claude } : { claude, codex };
}

// The `LOAD_STATE_DOCS` docs `options` asks for, each with its path and title.
function loadStateDocs(
  options: DocsFixtureOptions,
  fixture: FixturePaths,
  paths: Paths,
): { path: string; title: string; record: LoadStateRecord }[] {
  if (!options.loadStates) {
    return [];
  }
  return LOAD_STATE_DOCS.map((record) => ({
    path: paths.join(fixture.loadStates, `${record.state}.md`),
    title: `Load state ${record.state}`,
    record,
  }));
}

function indexDocument(
  fixture: FixturePaths,
  options: DocsFixtureOptions,
  paths: Paths,
): IndexDocument {
  const loadStates = loadStateDocs(options, fixture, paths);
  const repoOwned = { repo: 'selftest-repo', root: fixture.repo };
  const pluginOwned = { root: fixture.pluginRoot, plugin: FIXTURE_PLUGIN_KEY };
  const entries: IndexEntry[] = [
    entry({
      kind: 'instructions',
      source: 'global',
      path: fixture.claudeMd,
      title: 'Self-test instructions',
      meta: { imports: [] },
    }),
    entry({
      kind: 'rule',
      source: 'global',
      path: fixture.styleRule,
      title: 'Style',
      meta: { paths: [] },
    }),
    entry({
      id: `${fixture.settings}#hook:PreToolUse:0`,
      kind: 'hook',
      source: 'global',
      path: fixture.settings,
      title: 'PreToolUse Bash → lint',
      meta: { event: 'PreToolUse', matcher: 'Bash', command: 'lint' },
    }),
    entry({
      kind: 'plugin',
      source: 'plugin',
      ...pluginOwned,
      path: fixture.pluginRoot,
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
      path: fixture.repoAgentsMd,
      title: 'Repo instructions',
      meta: { imports: [] },
    }),
    entry({
      kind: 'skill',
      source: 'repo',
      ...repoOwned,
      path: fixture.repoSkill,
      title: 'demo',
      meta: { name: 'demo', description: 'A self-test skill.' },
    }),
    entry({
      kind: 'skill',
      source: 'plugin',
      ...pluginOwned,
      path: fixture.pluginSkill,
      title: 'cached',
      meta: { name: 'cached', description: 'A plugin skill.' },
    }),
    entry({
      id: `${fixture.followups}#L3`,
      kind: 'followup',
      source: 'features',
      repo: 'selftest-repo',
      root: fixture.featuresHome,
      path: fixture.followups,
      line: 3,
      title: 'First follow-up',
      meta: { status: 'open', gist: 'waits.', section: null },
    }),
    entry({
      kind: 'skill',
      source: 'global',
      owner: 'third-party',
      path: fixture.syncedSkill,
      title: 'synced-demo',
      meta: { name: 'synced-demo', description: 'A synced skill.' },
    }),
    entry({
      kind: 'skill',
      source: 'plugin',
      owner: 'third-party',
      root: fixture.vendorRoot,
      plugin: VENDOR_PLUGIN_KEY,
      path: fixture.vendorSkill,
      title: 'vendored',
      meta: { name: 'vendored', description: 'A third-party plugin skill.' },
    }),
    ...loadStates.map((doc) =>
      entry({
        kind: 'instructions',
        source: 'global',
        path: doc.path,
        title: doc.title,
        meta: { imports: [] },
      }),
    ),
  ];
  const contexts: IndexContext[] = [
    {
      folder: fixture.home,
      sessionId: null,
      loadedPlugins: {},
      states: {
        [fixture.claudeMd]: state(
          { state: 'launch', reason: 'user CLAUDE.md' },
          { state: 'not-loaded', reason: 'Claude Code file' },
        ),
        [fixture.styleRule]: state({
          state: 'launch',
          reason: 'rule without paths',
        }),
        ...Object.fromEntries(
          loadStates.map((doc) => [doc.path, state(doc.record)]),
        ),
      },
    },
    {
      folder: fixture.repo,
      sessionId: null,
      loadedPlugins: {},
      states: {
        [fixture.repoAgentsMd]: state(
          { state: 'launch', reason: 'AGENTS.md in the folder' },
          { state: 'launch', reason: 'AGENTS.md in the folder' },
        ),
      },
    },
  ];
  return {
    schemaVersion: 3,
    generatedAt: '2026-10-19T00:00:00Z',
    entries,
    contexts,
  };
}

// The first, second, fifth and sixth machine entries, judged for one session
// in the repo.
function sessionDocument(
  fixture: FixturePaths,
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
        folder: fixture.repo,
        sessionId: 'selftest-session',
        loadedPlugins: {},
        states: {
          [fixture.claudeMd]: state(inTranscript),
          [fixture.repoAgentsMd]: state(inTranscript),
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
function standInScript(home: string, indexDelayMs: number): string {
  return `import json, os, sys, time
HOME = ${JSON.stringify(home)}
DELAY_SECONDS = ${JSON.stringify(indexDelayMs / 1000)}
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
            doc["entries"].append({"id": path, "kind": "rule", "source": "global", "owner": "mine",
                "repo": None, "root": None, "plugin": None, "path": path, "line": None, "title": name,
                "meta": {"paths": []}, "walked": []})
    doc["entries"].sort(key=lambda entry: entry["id"])
    return json.dumps(doc, indent=2)
command = sys.argv[1] if len(sys.argv) > 1 else ""
time.sleep(DELAY_SECONDS)
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
