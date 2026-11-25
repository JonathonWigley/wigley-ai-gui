// Moves the `## Unreleased` entries of `CHANGELOG.md` under a new
// `## <version> — <YYYY-MM-DD>` heading and writes that version to
// `package.json` and both agent-plugin manifests (`AGENTS.md` § README,
// changelog and boundary). `wigley-push` runs it after rebasing the branch onto `main`.
// MINOR when Added, Changed or Removed hold an entry, PATCH when only Fixed
// does; a MAJOR bump is the user's, made by hand. Run from the app's root; it
// takes no arguments.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MINOR_HEADINGS = ['Added', 'Changed', 'Removed'];
const PATCH_HEADINGS = ['Fixed'];

interface Subsection {
  heading: string;
  lines: string[];
}

function nextVersion(version: string, isMinor: boolean): string {
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (parts === null) {
    throw new Error(`package.json version ${version} is not MAJOR.MINOR.PATCH`);
  }
  const [major, minor, patch] = parts.slice(1).map(Number);
  return isMinor ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
}

// `lines` without the blank lines that open and close it.
function trimmedBlanks(lines: string[]): string[] {
  const isText = (line: string) => line.trim() !== '';
  const start = lines.findIndex(isText);
  return start === -1
    ? []
    : lines.slice(start, lines.findLastIndex(isText) + 1);
}

// `changelog` with its Unreleased entries under a new version heading dated
// `today`, and that version, bumped from `version`; null when Unreleased holds
// no entry. Throws on a changelog with no `## Unreleased`, an unknown `###`
// heading under it, or a version that is not MAJOR.MINOR.PATCH.
export function release(
  changelog: string,
  version: string,
  today: string,
): { changelog: string; version: string } | null {
  const lines = changelog.split('\n');
  const start = lines.findIndex((line) => line.trim() === '## Unreleased');
  if (start === -1) {
    throw new Error('CHANGELOG.md has no ## Unreleased heading');
  }
  const afterStart = lines.slice(start + 1);
  const sectionLength = afterStart.findIndex((line) => line.startsWith('## '));
  const section =
    sectionLength === -1 ? afterStart : afterStart.slice(0, sectionLength);
  const rest = sectionLength === -1 ? [] : afterStart.slice(sectionLength);

  const intro: string[] = [];
  const subsections: Subsection[] = [];
  for (const line of section) {
    if (line.startsWith('### ')) {
      const heading = line.slice('### '.length).trim();
      if (![...MINOR_HEADINGS, ...PATCH_HEADINGS].includes(heading)) {
        throw new Error(`unknown heading under ## Unreleased: ${line}`);
      }
      subsections.push({ heading, lines: [] });
    } else if (subsections.length === 0) {
      intro.push(line);
    } else {
      subsections[subsections.length - 1].lines.push(line);
    }
  }
  const filled = subsections.filter((subsection) =>
    subsection.lines.some((line) => line.startsWith('- ')),
  );
  if (filled.length === 0) {
    return null;
  }
  const isMinor = filled.some(({ heading }) =>
    MINOR_HEADINGS.includes(heading),
  );
  const released = nextVersion(version, isMinor);
  const introLines = trimmedBlanks(intro);
  const releasedSection = filled.flatMap(({ heading, lines: body }) => [
    `### ${heading}`,
    '',
    ...trimmedBlanks(body),
    '',
  ]);
  const head = lines.slice(0, start + 1);
  const unreleased = introLines.length > 0 ? ['', ...introLines] : [];
  return {
    changelog: [
      ...head,
      ...unreleased,
      '',
      `## ${released} — ${today}`,
      '',
      ...releasedSection,
      ...rest,
    ].join('\n'),
    version: released,
  };
}

// `text` with its first `"version"` value set to `version`, every other byte
// kept, so formatting and review diffs stay clean.
function withVersion(text: string, file: string, version: string): string {
  const pattern = /("version"\s*:\s*")[^"]*(")/;
  if (!pattern.test(text)) {
    throw new Error(`${file} has no "version"`);
  }
  return text.replace(pattern, `$1${version}$2`);
}

function localDate(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const CHANGELOG = 'CHANGELOG.md';
const PACKAGE = 'package.json';
const MANIFESTS = [
  'agent-plugin/.claude-plugin/plugin.json',
  'agent-plugin/.codex-plugin/plugin.json',
];

function runRelease(): void {
  const packageText = readFileSync(PACKAGE, 'utf8');
  const parsed: unknown = JSON.parse(packageText);
  const version =
    typeof parsed === 'object' && parsed !== null && 'version' in parsed
      ? parsed.version
      : undefined;
  if (typeof version !== 'string') {
    throw new Error(`${PACKAGE} has no version`);
  }
  const result = release(
    readFileSync(CHANGELOG, 'utf8'),
    version,
    localDate(new Date()),
  );
  if (result === null) {
    console.log('nothing to release');
    return;
  }
  writeFileSync(CHANGELOG, result.changelog);
  for (const file of [PACKAGE, ...MANIFESTS]) {
    writeFileSync(
      file,
      withVersion(readFileSync(file, 'utf8'), file, result.version),
    );
  }
  console.log(`released ${result.version}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runRelease();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
