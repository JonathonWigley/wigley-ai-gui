// Fails on a raw colour, length, duration or font stack in CSS or an inline
// style under `src/`, or a `backdrop-filter` outside the material helpers
// (`DESIGN.md` § Checks). The rules live in `style-rules.mts`; this walks every
// file and prints what they report. It takes no arguments.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  argumentFailures,
  cssViolations,
  inlineStyleViolations,
  type StyleViolation,
} from './style-rules.mts';

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

function judgeFiles(): void {
  const checkedFiles = readdirSync('src', { recursive: true, encoding: 'utf8' })
    .map((file) => `src/${file.replaceAll(path.sep, '/')}`)
    .filter(isCheckedFile);
  const violationLines = checkedFiles.flatMap((file) =>
    violationsIn(file).map(
      ({ line, rule, text }) => `${file}:${line} ${rule}: ${text}`,
    ),
  );
  for (const line of violationLines) {
    console.error(line);
  }
  if (violationLines.length > 0) {
    process.exitCode = 1;
    return;
  }
  console.log(`styles: ${checkedFiles.length} files clean`);
}

const failures = argumentFailures(process.argv.slice(2));
if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exitCode = 1;
} else {
  judgeFiles();
}
