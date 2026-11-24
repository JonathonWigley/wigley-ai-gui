import { describe, expect, it } from 'vitest';
import {
  BOUNDARY_NAMES,
  boundaryHits,
  isExempt,
  isScanned,
  localNames,
} from './boundary-rules.mts';

// One row per BOUNDARY_NAMES entry, so a dropped or broken pattern fails.
const HITS = [
  { text: "const home = '~/wigley-agents';", name: '~/wigley-agents' },
  { text: 'read /Users/x/wigley-agents/AGENTS.md', name: '/wigley-agents/' },
  { text: "join(home, 'wigley-features')", name: 'wigley-features' },
  {
    text: 'plugins/cache/wigley-ai-marketplace/',
    name: 'wigley-ai-marketplace',
  },
  { text: "skill: 'wigley:small'", name: 'wigley: skill' },
  { text: "key: 'wigley@market'", name: 'wigley plugin key' },
  { text: '{ "wigley": { "on": true } }', name: 'wigley plugin key' },
  { text: "{ 'wigley': { on: true } }", name: 'wigley plugin key' },
  { text: '"plugins": ["other", "wigley"]', name: 'wigley plugin key' },
  { text: "plugins: ['other', 'wigley']", name: 'wigley plugin key' },
  { text: 'WigleyCapture.cs', name: 'WigleyCapture' },
  { text: 'runs capture.py first', name: 'capture.py' },
  { text: 'python3 plan.py read', name: 'plan.py' },
  {
    text: 'tools/x wigley-agents/tools/unity-pool',
    name: 'unity-pool install path',
  },
  { text: '"email": "pat.lee@company.co"', name: 'email address' },
  { text: 'by 123+pat@users.noreply.github.com', name: 'email address' },
  { text: "const home = '/Users/pat/Documents';", name: 'home path' },
  { text: "const home = '/Users/uz';", name: 'home path' },
];

describe('boundaryHits', () => {
  it.each(HITS)('boundaryHits_NameInSource_Hits: $text', ({ text, name }) => {
    expect(boundaryHits('src/x.ts', `first line\n${text}`)).toContainEqual({
      line: 2,
      name,
    });
  });

  it('boundaryHits_HitTable_CoversEveryPattern', () => {
    const covered = BOUNDARY_NAMES.filter(({ pattern }) =>
      HITS.some(({ text }) => pattern.test(text)),
    );
    expect(covered).toHaveLength(BOUNDARY_NAMES.length);
  });

  // Catches an over-broad pattern that fails the tree on a data folder, an env
  // name, the app's own name, a sample path or address, or an SSH login.
  it.each([
    '~/.agents/wigley-forms/rounds/',
    '~/.local/state/unity-pool/',
    '~/.agents/wigley-primer/primers/',
    'WIGLEY_SESSION_ROW',
    'wigley-ai-gui: the app',
    'unity-pool.scriptPath',
    'read_plan.py',
    "const name = 'otherwigley:x';",
    "exposeInMainWorld('wigley', bridge)",
    "const SAMPLE = 'wigley';",
    'fake@example.invalid',
    'pat@example.com',
    'git clone git@github.com:owner/repo.git',
    'npm i @scope/pkg react@18.3.1',
    "const home = '/Users/u/Documents';",
    'path: /Users/fake/.local/bin/claude',
    'ls /Users/<name>/',
  ])('boundaryHits_Passes: %s', (text) => {
    expect(boundaryHits('src/x.ts', text)).toEqual([]);
  });

  it('boundaryHits_SameTextInTestFile_Passes', () => {
    expect(boundaryHits('src/x.test.ts', "'wigley:small'")).toEqual([]);
  });

  it('boundaryHits_ExtraName_Hits', () => {
    const extra = localNames([{ source: 'boundary.name', value: 'Acme' }]);
    expect(boundaryHits('README.md', 'Built at ACME.', extra)).toEqual([
      { line: 1, name: 'local name (boundary.name)' },
    ]);
  });
});

describe('localNames', () => {
  // Catches a value read as a pattern (a `.` matching any character) and a
  // short value that would hit ordinary words.
  it.each([
    { value: 'a.b@c.de', text: 'mail a.b@c.de now', hits: true },
    { value: 'a.b@c.de', text: 'mail axb@c.de now', hits: false },
    { value: '  Acme  ', text: 'acme corp', hits: true },
    { value: 'ab', text: 'ab', hits: false },
  ])('localNames: $value in $text hits $hits', ({ value, text, hits }) => {
    const names = localNames([{ source: 'user.email', value }]);
    expect(names.some(({ pattern }) => pattern.test(text))).toBe(hits);
  });
});

describe('isScanned', () => {
  it.each([
    { path: 'src/plugins/x.ts', scanned: true },
    { path: 'agent-plugin/scripts/relay/relay.py', scanned: true },
    { path: 'scripts/check-boundary.mts', scanned: true },
    { path: '.claude-plugin/marketplace.json', scanned: true },
    { path: 'package.json', scanned: true },
    { path: 'forge.config.mts', scanned: true },
    { path: 'README.md', scanned: true },
    { path: 'CHANGELOG.md', scanned: true },
    { path: 'AGENTS.md', scanned: false },
    { path: 'DESIGN.md', scanned: false },
    { path: 'LICENSE', scanned: false },
    { path: 'package-lock.json', scanned: false },
    { path: 'docs/keymap.md', scanned: false },
    { path: '.claude/skills/drive/SKILL.md', scanned: false },
    { path: 'assets/icon.png', scanned: false },
  ])('isScanned: $path is $scanned', ({ path, scanned }) => {
    expect(isScanned(path)).toBe(scanned);
  });
});

describe('isExempt', () => {
  it.each([
    { path: 'src/plugins/x/main/start.test.ts', exempt: true },
    { path: 'scripts/x.test.mts', exempt: true },
    { path: 'src/plugins/x/fixtures.test-support.ts', exempt: true },
    { path: 'src/plugins/x/declared/fixtures/sample.json', exempt: true },
    { path: 'src/plugins/agent-skills/main/demo-steps.ts', exempt: true },
    { path: 'src/plugins/docs/main/selftest-fixture.ts', exempt: true },
    { path: 'docs/features/x/design.md', exempt: true },
    { path: 'agent-plugin/scripts/relay/tests/test_relay.py', exempt: true },
    { path: 'scripts/boundary-rules.mts', exempt: true },
    { path: 'src/plugins/x.ts', exempt: false },
    { path: 'src/plugins/x/sample-demo-steps.ts', exempt: false },
    { path: 'agent-plugin/scripts/relay/relay.py', exempt: false },
    { path: 'scripts/check-boundary.mts', exempt: false },
    { path: 'README.md', exempt: false },
  ])('isExempt: $path is $exempt', ({ path, exempt }) => {
    expect(isExempt(path)).toBe(exempt);
  });
});
