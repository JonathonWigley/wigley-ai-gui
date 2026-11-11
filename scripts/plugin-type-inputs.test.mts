import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  copyDeclarationInputs,
  type DeclarationFiles,
} from './plugin-type-inputs.mts';

// The script joins and resolves through `node:path`, so the fixture's paths
// are this OS's spelling.
const SRC = path.resolve('/repo/src');
const OUT = path.resolve('/repo/.plugin-types');
const at = (folder: string, file: string) => path.join(folder, file);

// Files by absolute path; `copy` copies text.
function memoryFiles(start: Record<string, string>): DeclarationFiles & {
  texts: Map<string, string>;
} {
  const texts = new Map(Object.entries(start));
  return {
    texts,
    exists: (file) => texts.has(file),
    read: (file) => {
      const text = texts.get(file);
      if (text === undefined) {
        throw new Error(`no ${file}`);
      }
      return text;
    },
    copy: (from, to) => {
      texts.set(to, texts.get(from) as string);
    },
    declarationsIn: (folder) =>
      [...texts.keys()].filter(
        (file) =>
          file.startsWith(`${folder}${path.sep}`) && file.endsWith('.d.ts'),
      ),
  };
}

describe('copyDeclarationInputs', () => {
  // The workflow contract's shape: an emitted contract imports a hand-written
  // layout.d.ts, which imports the hand-written kit.d.ts. An earlier run's
  // copies sit in OUT, since tsc builds into it incrementally.
  it.each<{ name: string; earlierCopies: Record<string, string> }>([
    { name: 'no earlier copies', earlierCopies: {} },
    {
      name: 'earlier copies overwritten',
      earlierCopies: {
        [at(OUT, 'plugins/workflow/layouts/layout.d.ts')]:
          "import type { Old } from './removed';",
        [at(OUT, 'shared/page/layout-host/kit.d.ts')]: 'export type Tag = 0;',
      },
    },
  ])(
    'copies each hand-written .d.ts the emit imports, and what that imports ($name)',
    ({ earlierCopies }) => {
      const files = memoryFiles({
        ...earlierCopies,
        [at(OUT, 'plugins/workflow/contract.d.ts')]: [
          "import type { Chip } from './layouts/layout';",
          "export type { Plugin } from '../../contracts/plugin';",
          "import type { App } from 'electron';",
        ].join('\n'),
        [at(OUT, 'contracts/plugin.d.ts')]: 'export type Plugin = {};',
        [at(SRC, 'plugins/workflow/layouts/layout.d.ts')]:
          "import type { Tag } from '../../../shared/page/layout-host/kit';",
        [at(SRC, 'shared/page/layout-host/kit.d.ts')]: 'export type Tag = 1;',
        [at(SRC, 'plugins/workflow/contract.ts')]: 'unread',
      });

      const copied = copyDeclarationInputs(SRC, OUT, files);

      expect(copied.sort()).toEqual([
        path.normalize('plugins/workflow/layouts/layout.d.ts'),
        path.normalize('shared/page/layout-host/kit.d.ts'),
      ]);
      expect(files.texts.get(at(OUT, 'shared/page/layout-host/kit.d.ts'))).toBe(
        'export type Tag = 1;',
      );
      expect(
        files.texts.get(at(OUT, 'plugins/workflow/layouts/layout.d.ts')),
      ).toBe(
        "import type { Tag } from '../../../shared/page/layout-host/kit';",
      );
    },
  );

  it('throws naming the file and specifier of an import with no declaration', () => {
    const files = memoryFiles({
      [at(OUT, 'plugins/notes/contract.d.ts')]:
        "export type { Gone } from './gone';",
    });

    expect(() => copyDeclarationInputs(SRC, OUT, files)).toThrow(
      `${path.normalize('plugins/notes/contract.d.ts')} imports "./gone"`,
    );
  });
});
