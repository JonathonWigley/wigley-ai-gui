// The boundary rule `check-boundary.mts` enforces (`AGENTS.md` § README,
// changelog and boundary): no app code names one user's setup or identity.
// Pure functions over a path and its text, so the names, scanned files and
// exemptions are tested without walking the repo.

export interface BoundaryName {
  name: string;
  pattern: RegExp;
}

// `/Users/<name>` folders that stand for no real user, so a sample path may
// use one.
const PLACEHOLDER_USERS = [
  'u',
  'x',
  'me',
  'you',
  'user',
  'name',
  'someone',
  'fake',
  'preview',
  'example',
  'Shared',
];

// Each name no scanned file may hold, with the pattern that finds it. Data
// folders (`~/.agents/wigley-forms/`, `~/.local/state/unity-pool/`), the app's
// own `wigley-ai-gui` name and `WIGLEY_` environment names are not on it. The
// identity patterns are shapes, so this file names no one: one user's own
// names come from `localNames`, read from their machine.
export const BOUNDARY_NAMES: readonly BoundaryName[] = [
  { name: '~/wigley-agents', pattern: /~\/wigley-agents/ },
  { name: '/wigley-agents/', pattern: /\/wigley-agents\// },
  { name: 'wigley-features', pattern: /wigley-features/ },
  { name: 'wigley-ai-marketplace', pattern: /wigley-ai-marketplace/ },
  { name: 'wigley: skill', pattern: /\bwigley:[a-z][a-z-]*/ },
  { name: 'wigley plugin key', pattern: /\bwigley@/ },
  {
    name: 'wigley plugin key',
    pattern: /(["'])wigley\1\s*:|[[,]\s*(["'])wigley\2\s*[,\]]/,
  },
  { name: 'WigleyCapture', pattern: /WigleyCapture/ },
  { name: 'capture.py', pattern: /\bcapture\.py\b/ },
  { name: 'plan.py', pattern: /\bplan\.py\b/ },
  {
    name: 'unity-pool install path',
    pattern: /wigley-agents\/tools\/unity-pool/,
  },
  // An address at any domain but a reserved one (`example.com`, `*.invalid`,
  // `*.test`, …); `git@` is an SSH login, not a person.
  {
    name: 'email address',
    pattern:
      /(?<![\w.%+-])(?!git@)[\w.%+-]+@(?!(?:[\w-]+\.)*(?:example\.(?:com|org|net)|[\w-]+\.(?:invalid|test|example|localhost))(?![\w.-]))[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}/,
  },
  {
    name: 'home path',
    pattern: new RegExp(
      String.raw`/Users/(?!(?:${PLACEHOLDER_USERS.join('|')})(?![\w.-]))[\w.-]+`,
    ),
  },
];

// The shortest local value `localNames` matches: shorter ones hit ordinary
// words.
const SHORTEST_LOCAL_VALUE = 3;

// A boundary name per value, matched case-insensitively as literal text and
// reported under its `source` (such as `user.email`), so the printed hit does
// not repeat the value. Values shorter than three characters are skipped.
export function localNames(
  values: readonly { source: string; value: string }[],
): BoundaryName[] {
  return values
    .map(({ source, value }) => ({ source, value: value.trim() }))
    .filter(({ value }) => value.length >= SHORTEST_LOCAL_VALUE)
    .map(({ source, value }) => ({
      name: `local name (${source})`,
      pattern: new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
    }));
}

// The app's top-level folders the scan covers, with every root file but those
// in UNSCANNED_ROOT_FILES: instructions for agents, the license's copyright
// holder and the generated lockfile.
const SCANNED_FOLDERS = ['src', 'agent-plugin', 'scripts', '.claude-plugin'];
const UNSCANNED_ROOT_FILES = [
  'AGENTS.md',
  'DESIGN.md',
  'LICENSE',
  'package-lock.json',
];

// Whether `path` (repo-relative, `/`-separated) is one the scan reads.
export function isScanned(path: string): boolean {
  const segments = path.split('/');
  if (segments.length === 1) {
    return !UNSCANNED_ROOT_FILES.includes(path);
  }
  return SCANNED_FOLDERS.includes(segments[0]);
}

const EXEMPT_SUFFIXES = ['.test.ts', '.test.mts', '.test-support.ts'];
const EXEMPT_SRC_FILES = ['demo-steps.ts', 'selftest-fixture.ts'];

// Whether `path` (repo-relative, `/`-separated) is a test, a fixture, the
// demo's sample data, a feature doc or this file, which may name the user's
// setup.
export function isExempt(path: string): boolean {
  const segments = path.split('/');
  const fileName = segments[segments.length - 1];
  const folders = segments.slice(0, -1);
  return (
    EXEMPT_SUFFIXES.some((suffix) => path.endsWith(suffix)) ||
    folders.includes('fixtures') ||
    (segments[0] === 'src' && EXEMPT_SRC_FILES.includes(fileName)) ||
    path.startsWith('docs/features/') ||
    (segments[0] === 'agent-plugin' && folders.includes('tests')) ||
    path === 'scripts/boundary-rules.mts'
  );
}

// Each line of `source` holding a boundary name, BOUNDARY_NAMES or one of
// `extraNames`, one hit per name per line, 1-based; none when `path` is
// exempt.
export function boundaryHits(
  path: string,
  source: string,
  extraNames: readonly BoundaryName[] = [],
): { line: number; name: string }[] {
  if (isExempt(path)) {
    return [];
  }
  const checked = [...BOUNDARY_NAMES, ...extraNames];
  const hits: { line: number; name: string }[] = [];
  source.split('\n').forEach((text, index) => {
    const names = new Set(
      checked
        .filter(({ pattern }) => pattern.test(text))
        .map(({ name }) => name),
    );
    for (const name of names) {
      hits.push({ line: index + 1, name });
    }
  });
  return hits;
}
