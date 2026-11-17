import type { InstalledPlugin } from '../../../contracts/agent';
import type { Files } from '../../../contracts/files';
import type { Paths } from '../../../contracts/paths';
import { FAKE_HARNESS_ID } from '../../../shared/fake-agent-harness';
import type {
  IndexContext,
  IndexDocument,
  IndexEntry,
  LoadStateRecord,
} from '../contract';
import { WIGLEY_PLUGIN_KEY } from './script-locator';
import { MACHINE_INDEX_FILE } from './index-sources';

const FIXTURE_PLUGIN_KEY = 'selftest-plugin@selftest-market';
// Starts `wigley@`, so the `wigley:vendored` link finds the plugin's skill.
const VENDOR_PLUGIN_KEY = 'wigley@vendor-market';
// Makes CLAUDE.md several pages long, rendered and in the editor, so a
// half-page scroll moves it.
const LONG_SECTION = `\n## Long section\n\n${Array.from(
  { length: 80 },
  (_, index) => `Line ${index + 1}.\n`,
).join('\n')}`;
const KEPT_RULE = 'style.md';
// One global doc per index load state other than `launch`, each written to
// `<state>.md` in the load-states folder and judged for the fake harness only.
const LOAD_STATE_DOCS: readonly LoadStateRecord[] = [
  { state: 'on-demand', reason: 'loads when invoked' },
  { state: 'listed', reason: 'listed by name only' },
  { state: 'shadowed', reason: 'a nearer file wins' },
  { state: 'not-loaded', reason: 'not read at launch' },
];

// The wiki's `Main.md`, relative to the temp home, and its text: the links on
// the first line sit before the first shelf, so they draw no sidebar rows.
export const WIKI_MAIN_FILE = 'wigley-agents/wiki/Main.md';
export const WIKI_MAIN_TEXT = `Start at [Fixture guides](wiki:kind/feature-doc), [The vendored skill](wigley:vendored) or [Every page](wiki:all).

## Shelf one

### Label one

- [Guide page](../../wigley-features/selftest-repo/wiki-fixture/guide.md)
- [Commit page](../../dev/backlog-repo/docs/features/backlog-x/plan-x/plan.md)
- [Gone page](gone.md)
- [Fixture guides](wiki:kind/feature-doc)

## Shelf two

- [Every page](wiki:all)
- [Vendor docs](wiki:owner/third-party)
`;

// A doc with no `#` heading, relative to the temp home, whose first line holds
// a `§` link with backticks and a bare one, and taller than the pane so a link
// to its last section scrolls.
export const WIKI_GUIDE_FILE =
  'wigley-features/selftest-repo/wiki-fixture/guide.md';
export const WIKI_GUIDE_TEXT = `Read \`target.md\` § Target part for the target, and § Closing notes for the end.

## Opening notes

Opening text.

## Middle notes

Middle text.

## Closing notes

Closing text.

${'More closing text.\n\n'.repeat(40)}`;

const WIKI_TARGET_FILE = 'wigley-features/selftest-repo/wiki-fixture/target.md';
const WIKI_TARGET_TEXT =
  '# Fixture target\n\nText above.\n\n## Target part\n\nText below.\n';

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
    [fixture.wikiMain, WIKI_MAIN_TEXT],
    [fixture.wikiGuide, WIKI_GUIDE_TEXT],
    [fixture.wikiTarget, WIKI_TARGET_TEXT],
    ...loadStateDocs(options, fixture, paths).map((doc): [string, string] => [
      doc.path,
      `# ${doc.title}\n`,
    ]),
    [fixture.installedPlugins, installedPluginsText(fixture)],
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
    installedPlugins: paths.join(
      claudeDir,
      'plugins',
      'installed_plugins.json',
    ),
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
    backlogHome: paths.join(home, 'dev/backlog-repo/docs/features'),
    backlogPlanFolder: paths.join(
      home,
      'dev/backlog-repo/docs/features/backlog-x/plan-x',
    ),
    followups: paths.join(home, 'wigley-features/selftest-repo/followups.md'),
    wikiMain: paths.join(home, WIKI_MAIN_FILE),
    wikiGuide: paths.join(home, WIKI_GUIDE_FILE),
    wikiTarget: paths.join(home, WIKI_TARGET_FILE),
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

// The installs the fixture's `installed_plugins.json` lists, as a harness's
// `installedPlugins` gives them: what a run on the fake harness hands it for
// each profile, since the fake reads no file.
export function docsFixtureInstalls(
  home: string,
  paths: Paths,
): InstalledPlugin[] {
  const fixture = fixturePaths(home, paths);
  return [
    {
      key: WIGLEY_PLUGIN_KEY,
      installDir: fixture.wigleyInstall,
      version: '0.0.0',
      listedAt: { path: fixture.installedPlugins, line: 2 },
    },
    {
      key: FIXTURE_PLUGIN_KEY,
      installDir: fixture.pluginRoot,
      version: '1.0.0',
      listedAt: { path: fixture.installedPlugins, line: 3 },
    },
  ];
}

// The wigley key sits on line 2, the fixture plugin's on line 3.
function installedPluginsText(fixture: FixturePaths): string {
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
    headings: [],
    links: [],
    lastLoaded: null,
    ...fields,
  };
}

// A doc's load states, keyed by the fake's id: a fake run registers it, so its
// chips draw; no `codex` harness registers, so a `codex` record draws none.
function state(
  primary: LoadStateRecord,
  codex?: LoadStateRecord,
): Partial<Record<string, LoadStateRecord>> {
  return codex === undefined
    ? { [FAKE_HARNESS_ID]: primary }
    : { [FAKE_HARNESS_ID]: primary, codex };
}

// The Backlog self-test's git repo (written by Backlog's fixture): its
// follow-ups by their `##` heading lines, its plan and the plan's two tasks.
function backlogEntries(fixture: FixturePaths, paths: Paths): IndexEntry[] {
  const homeOwned = { repo: 'backlog-repo', root: fixture.backlogHome };
  const followups = paths.join(fixture.backlogHome, 'followups.md');
  const followup = (
    line: number,
    title: string,
    gist: string,
    status: 'open' | 'done',
    tags: string[],
  ) =>
    entry({
      id: `${followups}#L${String(line)}`,
      kind: 'followup',
      source: 'features',
      ...homeOwned,
      path: followups,
      line,
      title,
      meta: { status, gist, section: null, tags },
    });
  const task = (file: string, title: string, status: string) =>
    entry({
      kind: 'task',
      source: 'features',
      ...homeOwned,
      path: paths.join(fixture.backlogPlanFolder, file),
      title,
      meta: { plan: 'x', status },
    });
  return [
    followup(11, 'Ready item', 'waits for an agent', 'open', ['agent-ready']),
    followup(15, 'Plain item', 'needs a look', 'open', []),
    followup(19, 'Shipped item', 'landed', 'done', []),
    followup(23, 'Moved item', 'reads `src/app.ts`', 'open', []),
    followup(27, 'Stale item', 'reads `src/gone.ts`', 'open', []),
    entry({
      kind: 'plan',
      source: 'features',
      ...homeOwned,
      path: paths.join(fixture.backlogPlanFolder, 'plan.md'),
      title: 'Backlog X',
      meta: { feature: 'backlog-x', checked: 1, total: 2 },
    }),
    task('01-first.md', 'First task', 'done'),
    task('02-second.md', 'Second task', 'not started'),
  ];
}

// The docs the wiki's `Main.md` links, with the headings and links the index
// holds for them, and `Main.md` itself.
function wikiEntries(fixture: FixturePaths): IndexEntry[] {
  const featureDoc = { repo: 'selftest-repo', root: fixture.featuresHome };
  const meta = { feature: 'wiki-fixture' };
  return [
    entry({
      kind: 'reference',
      source: 'global',
      path: fixture.wikiMain,
      title: 'Fixture main page',
      meta: {},
      headings: [
        { level: 2, text: 'Shelf one', line: 3 },
        { level: 3, text: 'Label one', line: 5 },
        { level: 2, text: 'Shelf two', line: 12 },
      ],
      links: [
        {
          form: 'markdown',
          raw: '[Guide page](../../wigley-features/selftest-repo/wiki-fixture/guide.md)',
          target: fixture.wikiGuide,
          line: 7,
          targetLine: null,
        },
      ],
    }),
    entry({
      kind: 'feature-doc',
      source: 'features',
      ...featureDoc,
      path: fixture.wikiGuide,
      title: 'Fixture guide',
      meta,
      headings: [
        { level: 2, text: 'Opening notes', line: 3 },
        { level: 2, text: 'Middle notes', line: 7 },
        { level: 2, text: 'Closing notes', line: 11 },
      ],
      links: [
        {
          form: 'section',
          raw: '`target.md` § Target part',
          target: fixture.wikiTarget,
          line: 1,
          targetLine: 5,
        },
        {
          form: 'section',
          raw: '§ Closing notes',
          target: fixture.wikiGuide,
          line: 1,
          targetLine: 11,
        },
      ],
    }),
    entry({
      kind: 'feature-doc',
      source: 'features',
      ...featureDoc,
      path: fixture.wikiTarget,
      title: 'Fixture target',
      meta,
      headings: [
        { level: 1, text: 'Fixture target', line: 1 },
        { level: 2, text: 'Target part', line: 5 },
      ],
    }),
  ];
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
      headings: [{ level: 2, text: 'Long section', line: 9 }],
    }),
    entry({
      kind: 'rule',
      source: 'global',
      path: fixture.styleRule,
      title: 'Style',
      meta: { paths: [] },
      lastLoaded: '2026-10-18T12:00:00.000Z',
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
        harness: FAKE_HARNESS_ID,
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
    ...backlogEntries(fixture, paths),
    ...wikiEntries(fixture),
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
    schemaVersion: 5,
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
                "meta": {"paths": []}, "walked": [], "headings": [], "links": [], "lastLoaded": None})
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
