// Fails on a boundary name — one user's setup or identity — in a file the scan
// reads: under `src/`, `agent-plugin/`, `scripts/` or `.claude-plugin/`, or a
// root file such as `README.md`, `CHANGELOG.md`, `package.json` or
// `forge.config.mts` (`AGENTS.md` § README, changelog and boundary). The rules
// live in `boundary-rules.mts`; this lists the tracked and untracked files,
// adds this machine's own names from git config (`user.email`, and each
// `boundary.name`, such as an employer, set with
// `git config --global --add boundary.name <name>`) and prints each hit as
// `path:line: name`. Run from the app's root; it takes no arguments.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { boundaryHits, isScanned, localNames } from './boundary-rules.mts';

function scannedFiles(): string[] {
  const listed = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { encoding: 'utf8' },
  );
  const files = listed
    .split('\n')
    .filter((file) => file !== '' && isScanned(file));
  // A tracked file deleted in the working tree is still listed.
  return [...new Set(files)].filter((file) => existsSync(file));
}

// Every value of git config `key`; none when it is unset.
function gitConfigValues(key: string): string[] {
  try {
    return execFileSync('git', ['config', '--get-all', key], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .filter((value) => value !== '');
  } catch {
    return [];
  }
}

const extraNames = localNames(
  ['user.email', 'boundary.name'].flatMap((source) =>
    gitConfigValues(source).map((value) => ({ source, value })),
  ),
);
const files = scannedFiles();
const hitLines = files.flatMap((file) => {
  const source = readFileSync(file, 'utf8');
  if (source.includes('\u0000')) {
    return [];
  }
  return boundaryHits(file, source, extraNames).map(
    ({ line, name }) => `${file}:${line}: ${name}`,
  );
});
for (const hitLine of hitLines) {
  console.error(hitLine);
}
if (hitLines.length > 0) {
  console.error(
    `boundary: ${hitLines.length} hits; move each to an auri.json contribution or a generic name (AGENTS.md § README, changelog and boundary)`,
  );
  process.exitCode = 1;
} else {
  console.log(`boundary: ${files.length} files clean`);
}
