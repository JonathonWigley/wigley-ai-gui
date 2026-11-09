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
// declarations tsc emitted into `outDir` import, directly or through another
// copy, at its path relative to `srcDir`, over any copy an earlier run left:
// tsc emits nothing for a `.d.ts` input. Throws, naming the file and
// specifier, for a relative import that leads to no `.d.ts` in either folder.
// Resolves the paths copied, relative to `outDir`.
export function copyDeclarationInputs(
  srcDir: string,
  outDir: string,
  files: DeclarationFiles,
): string[] {
  const copied: string[] = [];
  const copiedTargets = new Set<string>();
  const isHandWrittenIn = (target: string) =>
    files.exists(path.join(srcDir, path.relative(outDir, target)));
  // An earlier run's copy is read only once this run copies it again.
  const pending = files
    .declarationsIn(outDir)
    .filter((declaration) => !isHandWrittenIn(declaration));
  let file: string | undefined;
  while ((file = pending.pop()) !== undefined) {
    for (const [, specifier] of files.read(file).matchAll(RELATIVE_SPECIFIER)) {
      const target = `${path.resolve(path.dirname(file), specifier)}${DECLARATION_SUFFIX}`;
      const relative = path.relative(outDir, target);
      const isInOutDir =
        !relative.startsWith('..') && !path.isAbsolute(relative);
      const isHandWritten = isInOutDir && isHandWrittenIn(target);
      if (isHandWritten && !copiedTargets.has(target)) {
        files.copy(path.join(srcDir, relative), target);
        copied.push(relative);
        copiedTargets.add(target);
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
