import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';

// The file system `copyDeclarationInputs` reads and writes, by absolute path.
export interface DeclarationFiles {
  exists(file: string): boolean;
  read(file: string): string;
  // Copies `from` to `to`, making `to`'s folders.
  copy(from: string, to: string): void;
  // Every `.d.ts` file under `folder`, at every level.
  declarationsIn(folder: string): string[];
}

const DECLARATION_SUFFIX = '.d.ts';
// A relative specifier after `from` or in `import(`.
const RELATIVE_SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;

export const nodeDeclarationFiles: DeclarationFiles = {
  exists: (file) => existsSync(file),
  read: (file) => readFileSync(file, 'utf8'),
  copy: (from, to) => {
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(from, to);
  },
  declarationsIn: (folder) =>
    readdirSync(folder, { recursive: true, encoding: 'utf8' })
      .filter((entry) => entry.endsWith(DECLARATION_SUFFIX))
      .map((entry) => path.join(folder, entry)),
};

// Copies into `outDir` every hand-written `.d.ts` under `srcDir` that the
// declarations in `outDir` import, directly or through another copy, at its
// path relative to `srcDir`: tsc emits nothing for a `.d.ts` input. Throws,
// naming the file and specifier, for a relative import that leads to no
// `.d.ts` in either folder. Resolves the paths copied, relative to `outDir`.
export function copyDeclarationInputs(
  srcDir: string,
  outDir: string,
  files: DeclarationFiles,
): string[] {
  const copied: string[] = [];
  const pending = files.declarationsIn(outDir);
  const walked = new Set(pending);
  let file: string | undefined;
  while ((file = pending.pop()) !== undefined) {
    for (const [, specifier] of files.read(file).matchAll(RELATIVE_SPECIFIER)) {
      const target = `${path.resolve(path.dirname(file), specifier)}${DECLARATION_SUFFIX}`;
      const relative = path.relative(outDir, target);
      const source = path.join(srcDir, relative);
      const isInOutDir =
        !relative.startsWith('..') && !path.isAbsolute(relative);
      const isHandWritten = isInOutDir && files.exists(source);
      if (isHandWritten && !walked.has(target)) {
        files.copy(source, target);
        copied.push(relative);
        walked.add(target);
        pending.push(target);
      } else if (!isHandWritten && !files.exists(target)) {
        throw new Error(
          `${path.relative(outDir, file)} imports "${specifier}", which has no ${DECLARATION_SUFFIX} in ${srcDir} or ${outDir}`,
        );
      }
    }
  }
  return copied;
}
