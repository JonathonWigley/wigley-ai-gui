import { describe, expect, it } from 'vitest';
import {
  copyDeclarationInputs,
  type DeclarationFiles,
} from './plugin-type-inputs.mts';

const SRC = '/repo/src';
const OUT = '/repo/.plugin-types';

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
        (file) => file.startsWith(`${folder}/`) && file.endsWith('.d.ts'),
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
        [`${OUT}/plugins/workflow/layouts/layout.d.ts`]:
          "import type { Old } from './removed';",
        [`${OUT}/shared/page/layout-host/kit.d.ts`]: 'export type Tag = 0;',
      },
    },
  ])(
    'copies each hand-written .d.ts the emit imports, and what that imports ($name)',
    ({ earlierCopies }) => {
      const files = memoryFiles({
        ...earlierCopies,
        [`${OUT}/plugins/workflow/contract.d.ts`]: [
          "import type { Chip } from './layouts/layout';",
          "export type { Plugin } from '../../contracts/plugin';",
          "import type { App } from 'electron';",
        ].join('\n'),
        [`${OUT}/contracts/plugin.d.ts`]: 'export type Plugin = {};',
        [`${SRC}/plugins/workflow/layouts/layout.d.ts`]:
          "import type { Tag } from '../../../shared/page/layout-host/kit';",
        [`${SRC}/shared/page/layout-host/kit.d.ts`]: 'export type Tag = 1;',
        [`${SRC}/plugins/workflow/contract.ts`]: 'unread',
      });

      const copied = copyDeclarationInputs(SRC, OUT, files);

      expect(copied.sort()).toEqual([
        'plugins/workflow/layouts/layout.d.ts',
        'shared/page/layout-host/kit.d.ts',
      ]);
      expect(files.texts.get(`${OUT}/shared/page/layout-host/kit.d.ts`)).toBe(
        'export type Tag = 1;',
      );
      expect(
        files.texts.get(`${OUT}/plugins/workflow/layouts/layout.d.ts`),
      ).toBe(
        "import type { Tag } from '../../../shared/page/layout-host/kit';",
      );
    },
  );

  it('throws naming the file and specifier of an import with no declaration', () => {
    const files = memoryFiles({
      [`${OUT}/plugins/notes/contract.d.ts`]:
        "export type { Gone } from './gone';",
    });

    expect(() => copyDeclarationInputs(SRC, OUT, files)).toThrow(
      'plugins/notes/contract.d.ts imports "./gone"',
    );
  });
});
