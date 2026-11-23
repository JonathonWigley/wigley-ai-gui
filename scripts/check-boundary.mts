// Fails on a boundary name — one user's setup — in a file under `src/`,
// `agent-plugin/` or `scripts/`, or in `README.md` or `CHANGELOG.md`
// (`AGENTS.md` § README, changelog and boundary). The rules live in
// `boundary-rules.mts`; this lists the tracked and untracked files and prints
// each hit as `path:line: name`. Run from the app's root; it takes no
// arguments.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { boundaryHits } from './boundary-rules.mts';

const SCANNED = ['src', 'agent-plugin', 'scripts', 'README.md', 'CHANGELOG.md'];

function scannedFiles(): string[] {
  const listed = execFileSync(
    'git',
    [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      ...SCANNED,
    ],
    { encoding: 'utf8' },
  );
  const files = listed.split('\n').filter((file) => file !== '');
  // A tracked file deleted in the working tree is still listed.
  return [...new Set(files)].filter((file) => existsSync(file));
}

const files = scannedFiles();
const hitLines = files.flatMap((file) => {
  const source = readFileSync(file, 'utf8');
  if (source.includes('\u0000')) {
    return [];
  }
  return boundaryHits(file, source).map(
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
