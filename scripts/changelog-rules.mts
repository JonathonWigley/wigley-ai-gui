// The changelog rules `check-changelog.mts` enforces (`AGENTS.md` § README,
// changelog and boundary): a branch that changes app code adds an entry under
// `## Unreleased` under a `###` heading, and the app and its agent plugin
// carry one version. Pure functions over paths and text, so the rules are
// tested without git.

// Folders whose files are docs or agent instructions, which need no entry.
const NO_ENTRY_FOLDERS = ['docs/', '.claude/', '.agents/'];

// The changed paths (relative to the app's root, `/`-separated) that call for a
// changelog entry: every path but those under `docs/`, `.claude/` and
// `.agents/` and the root `*.md` files.
export function needsEntry(changedPaths: string[]): string[] {
  return changedPaths.filter((changedPath) => {
    const isRootMarkdown =
      !changedPath.includes('/') && changedPath.endsWith('.md');
    const isInNoEntryFolder = NO_ENTRY_FOLDERS.some((folder) =>
      changedPath.startsWith(folder),
    );
    return !isRootMarkdown && !isInNoEntryFolder;
  });
}

const UNRELEASED = '## Unreleased';

interface Section {
  heading: string;
  entries: string[];
}

// Each `## ` section of `changelog` with its `- ` entry lines.
function sections(changelog: string): Section[] {
  const found: Section[] = [];
  for (const line of changelog.split('\n')) {
    if (line.startsWith('## ')) {
      found.push({ heading: line.trim(), entries: [] });
    } else if (line.startsWith('- ') && found.length > 0) {
      found[found.length - 1].entries.push(line);
    }
  }
  return found;
}

// The `- ` lines under `## Unreleased` in `headText` that the base's
// `## Unreleased` does not hold, each counted as often as it appears. A
// version section the base lacks counts as Unreleased, so a branch whose
// entries `changelog:release` moved under its new heading still shows them.
// It compares sections rather than reading a diff, since a hunk often holds no
// heading to place an added line under.
export function addedEntryLines(baseText: string, headText: string): string[] {
  const baseSections = sections(baseText);
  const baseHeadings = new Set(baseSections.map(({ heading }) => heading));
  const baseCounts = new Map<string, number>();
  for (const { heading, entries } of baseSections) {
    if (heading !== UNRELEASED) {
      continue;
    }
    for (const line of entries) {
      baseCounts.set(line, (baseCounts.get(line) ?? 0) + 1);
    }
  }
  return sections(headText)
    .filter(
      ({ heading }) => heading === UNRELEASED || !baseHeadings.has(heading),
    )
    .flatMap(({ entries }) => entries)
    .filter((line) => {
      const left = baseCounts.get(line) ?? 0;
      if (left === 0) {
        return true;
      }
      baseCounts.set(line, left - 1);
      return false;
    });
}

// The `- ` lines under `## Unreleased` in `changelog` that sit above its first
// `### ` heading: `changelog:release` moves only the entries under a `###`
// heading, so these would never be released.
export function uncategorizedEntries(changelog: string): string[] {
  const found: string[] = [];
  let isInUnreleased = false;
  let isUnderHeading = false;
  for (const line of changelog.split('\n')) {
    if (line.startsWith('## ')) {
      isInUnreleased = line.trim() === UNRELEASED;
      isUnderHeading = false;
    } else if (line.startsWith('### ')) {
      isUnderHeading = true;
    } else if (isInUnreleased && !isUnderHeading && line.startsWith('- ')) {
      found.push(line);
    }
  }
  return found;
}

// A reason naming each file and its version when `versions` (file → version)
// holds more than one version; null when they agree.
export function versionMismatch(
  versions: Record<string, string>,
): string | null {
  const entries = Object.entries(versions);
  if (new Set(entries.map(([, version]) => version)).size <= 1) {
    return null;
  }
  const listed = entries
    .map(([file, version]) => `${file} ${version}`)
    .join(', ');
  return `versions disagree: ${listed}; package.json and both agent-plugin manifests carry one version`;
}
