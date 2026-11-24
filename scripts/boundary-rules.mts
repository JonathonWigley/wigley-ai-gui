// The boundary rule `check-boundary.mts` enforces (`AGENTS.md` § README,
// changelog and boundary): no app code names one user's setup. Pure functions
// over a path and its text, so the names and exemptions are tested without
// walking the repo.

// Each name no scanned file may hold, with the pattern that finds it. Data
// folders (`~/.agents/wigley-forms/`, `~/.local/state/unity-pool/`), the app's
// own `wigley-ai-gui` name and `WIGLEY_` environment names are not on it.
export const BOUNDARY_NAMES: readonly { name: string; pattern: RegExp }[] = [
  { name: '~/wigley-agents', pattern: /~\/wigley-agents/ },
  { name: '/wigley-agents/', pattern: /\/wigley-agents\// },
  { name: 'wigley-features', pattern: /wigley-features/ },
  { name: 'wigley-ai-marketplace', pattern: /wigley-ai-marketplace/ },
  { name: 'wigley: skill', pattern: /\bwigley:[a-z][a-z-]*/ },
  { name: 'wigley plugin key', pattern: /\bwigley@/ },
  {
    name: 'wigley plugin key',
    pattern: /"wigley"\s*:|[[,]\s*"wigley"\s*[,\]]/,
  },
  { name: 'WigleyCapture', pattern: /WigleyCapture/ },
  { name: 'capture.py', pattern: /\bcapture\.py\b/ },
  { name: 'plan.py', pattern: /\bplan\.py\b/ },
  {
    name: 'unity-pool install path',
    pattern: /wigley-agents\/tools\/unity-pool/,
  },
];

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

// Each line of `source` holding a boundary name, one hit per name per line,
// 1-based; none when `path` is exempt.
export function boundaryHits(
  path: string,
  source: string,
): { line: number; name: string }[] {
  if (isExempt(path)) {
    return [];
  }
  const hits: { line: number; name: string }[] = [];
  source.split('\n').forEach((text, index) => {
    const names = new Set(
      BOUNDARY_NAMES.filter(({ pattern }) => pattern.test(text)).map(
        ({ name }) => name,
      ),
    );
    for (const name of names) {
      hits.push({ line: index + 1, name });
    }
  });
  return hits;
}
