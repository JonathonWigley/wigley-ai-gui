// Fails when the branch changes app code against `origin/main` and adds no
// entry under `## Unreleased` in `CHANGELOG.md`, or when `package.json` and the
// two agent-plugin manifests carry different versions (`AGENTS.md` § README,
// changelog and boundary). The rules live in `changelog-rules.mts`; this reads
// git and the files and prints what they report. Run from the app's root; it
// takes no arguments.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import {
  addedEntryLines,
  needsEntry,
  versionMismatch,
} from './changelog-rules.mts';

const CHANGELOG = 'CHANGELOG.md';
const VERSION_FILES = [
  'package.json',
  'agent-plugin/.claude-plugin/plugin.json',
  'agent-plugin/.codex-plugin/plugin.json',
];
// The most changed paths a failure lists before it counts the rest.
const LISTED_PATHS = 10;

function git(args: string[]): string {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

function gitLines(args: string[]): string[] {
  return git(args)
    .split('\n')
    .filter((line) => line !== '');
}

function hasOriginMain(): boolean {
  try {
    git(['rev-parse', '--verify', '--quiet', 'origin/main']);
    return true;
  } catch {
    return false;
  }
}

function versionProblem(): string | null {
  const versions: Record<string, string> = {};
  for (const file of VERSION_FILES) {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const version =
      typeof parsed === 'object' && parsed !== null && 'version' in parsed
        ? parsed.version
        : undefined;
    versions[file] = typeof version === 'string' ? version : '(none)';
  }
  return versionMismatch(versions);
}

// The base's changelog, empty when the base has none.
function baseChangelog(mergeBase: string): string {
  try {
    return git(['show', `${mergeBase}:./${CHANGELOG}`]);
  } catch {
    return '';
  }
}

// Each failure reason; none when the branch passes.
function entryProblems(): string[] {
  const mergeBase = git(['merge-base', 'origin/main', 'HEAD']).trim();
  const changed = [
    ...gitLines(['diff', '--name-only', '--relative', mergeBase]),
    ...gitLines(['ls-files', '--others', '--exclude-standard']),
  ];
  const needing = needsEntry([...new Set(changed)]);
  if (needing.length === 0) {
    console.log('changelog: no app changes against origin/main');
    return [];
  }
  const head = existsSync(CHANGELOG) ? readFileSync(CHANGELOG, 'utf8') : '';
  if (addedEntryLines(baseChangelog(mergeBase), head).length > 0) {
    console.log(
      `changelog: ${needing.length} app files changed, entry added under ## Unreleased`,
    );
    return [];
  }
  const listed = needing.slice(0, LISTED_PATHS).map((file) => `  ${file}`);
  const more = needing.length - listed.length;
  return [
    'changelog: app files changed against origin/main with no entry:',
    ...listed,
    ...(more > 0 ? [`  …and ${more} more`] : []),
    'add a line under ## Unreleased in CHANGELOG.md (AGENTS.md § README, changelog and boundary)',
  ];
}

const versionReason = versionProblem();
const problems = versionReason === null ? [] : [`changelog: ${versionReason}`];
if (hasOriginMain()) {
  problems.push(...entryProblems());
} else {
  console.log('changelog: skipped: no origin/main');
}
for (const problem of problems) {
  console.error(problem);
}
if (problems.length > 0) {
  process.exitCode = 1;
}
