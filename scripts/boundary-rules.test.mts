import { describe, expect, it } from 'vitest';
import { BOUNDARY_NAMES, boundaryHits, isExempt } from './boundary-rules.mts';

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
  { text: '"plugins": ["other", "wigley"]', name: 'wigley plugin key' },
  { text: 'WigleyCapture.cs', name: 'WigleyCapture' },
  { text: 'runs capture.py first', name: 'capture.py' },
  { text: 'python3 plan.py read', name: 'plan.py' },
  {
    text: 'tools/x wigley-agents/tools/unity-pool',
    name: 'unity-pool install path',
  },
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
  // name or the app's own name.
  it.each([
    '~/.agents/wigley-forms/rounds/',
    '~/.local/state/unity-pool/',
    '~/.agents/wigley-primer/primers/',
    'WIGLEY_SESSION_ROW',
    'wigley-ai-gui: the app',
    'unity-pool.scriptPath',
    'read_plan.py',
    "const name = 'jonathonwigley:x';",
  ])('boundaryHits_Passes: %s', (text) => {
    expect(boundaryHits('src/x.ts', text)).toEqual([]);
  });

  it('boundaryHits_SameTextInTestFile_Passes', () => {
    expect(boundaryHits('src/x.test.ts', "'wigley:small'")).toEqual([]);
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
