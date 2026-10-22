// Fails on a raw colour, length, duration or font stack in CSS or an inline
// style under `src/`, or a `backdrop-filter` outside the material helpers
// (`DESIGN.md` § Checks). The rules live in `style-rules.mts`; this walks the
// files and prints what they report. `--no-legacy [<path>…]` ignores
// LEGACY_FILES and, given paths, judges only those files.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  cssViolations,
  inlineStyleViolations,
  legacyListProblems,
  parseStyleArguments,
  type StyleViolation,
} from './style-rules.mts';

// Files plan C rebuilds onto the tokens. Plan C's surface tasks leave this
// list alone and prove their rebuilt files with `--no-legacy <path>…`; a listed
// file that passes every rule prints a note, not a failure. Plan C's final task
// deletes the list.
const LEGACY_FILES: string[] = [
  'src/plugins/chat/page/chat.css',
  'src/plugins/docs/page/docs.css',
  'src/plugins/docs/page/tree-view.ts',
  'src/plugins/forms/page/forms.css',
  'src/plugins/keys/page/keys.css',
  'src/plugins/sessions/page/sessions.css',
  'src/shared/page/dialog.css',
  'src/shared/page/markdown.css',
];

const BACKDROP_FILTER_FILE = 'src/shared/page/ui/materials.css';

function isCheckedFile(file: string): boolean {
  const isScript =
    (file.endsWith('.ts') || file.endsWith('.js')) &&
    !file.endsWith('.test.ts');
  return file.endsWith('.css') || isScript;
}

function violationsIn(file: string): StyleViolation[] {
  const source = readFileSync(file, 'utf8');
  return file.endsWith('.css')
    ? cssViolations(source, file === BACKDROP_FILTER_FILE)
    : inlineStyleViolations(file, source);
}

const checkedFiles = readdirSync('src', { recursive: true, encoding: 'utf8' })
  .map((file) => `src/${file.replaceAll(path.sep, '/')}`)
  .filter(isCheckedFile);
const filesInSrc = new Set(checkedFiles);
const { ignoreLegacy, paths, failures } = parseStyleArguments(
  process.argv.slice(2),
  filesInSrc,
);
// A bad argument stops the run before judging, so a mistyped path never
// falls back to judging every file.
if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

const judgedFiles =
  paths.length > 0
    ? paths
    : checkedFiles.filter(
        (file) => ignoreLegacy || !LEGACY_FILES.includes(file),
      );
const violationLines = judgedFiles.flatMap((file) =>
  violationsIn(file).map(
    ({ line, rule, text }) => `${file}:${line} ${rule}: ${text}`,
  ),
);

if (!ignoreLegacy) {
  const legacyFilesWithViolations = new Set(
    LEGACY_FILES.filter(
      (file) => filesInSrc.has(file) && violationsIn(file).length > 0,
    ),
  );
  const legacy = legacyListProblems(
    LEGACY_FILES,
    filesInSrc,
    legacyFilesWithViolations,
  );
  failures.push(...legacy.failures);
  for (const note of legacy.notes) {
    console.log(note);
  }
}

for (const line of [...violationLines, ...failures]) {
  console.error(line);
}
if (violationLines.length > 0 || failures.length > 0) {
  process.exit(1);
}
const listed = ignoreLegacy
  ? 'legacy list ignored'
  : `${LEGACY_FILES.length} on the legacy list`;
console.log(`styles: ${judgedFiles.length} files clean, ${listed}`);
