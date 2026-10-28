// Type-checks every owner's `layout.d.ts` as the user's layouts folder holds
// it: beside `kit.d.ts`, its kit specifier rewritten, with no lib check
// skipped, so a kit member clashing with `BaseKit` fails here and not in the
// user's editor.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { userLayoutTypes } from './layout-registry';

const KIT_FILE = 'src/shared/page/layout-host/kit.d.ts';
const USER_KIT_SPECIFIER = '../kit';
// The user's layouts folder, as the compiler sees it.
const FOLDER = '/layouts';

// Each owner's repo `layout.d.ts` text, by owner.
function ownerContracts(): Record<string, string> {
  const contracts: Record<string, string> = {
    shell: readFileSync('src/renderer/shell/layouts/layout.d.ts', 'utf8'),
  };
  for (const plugin of readdirSync('src/plugins')) {
    const file = path.posix.join('src/plugins', plugin, 'layouts/layout.d.ts');
    try {
      contracts[plugin] = readFileSync(file, 'utf8');
    } catch {
      // A plugin with no layouts has no contract.
    }
  }
  return contracts;
}

// Each owner's problems: every relative import but the kit's, then every
// compiler error, as `TS<code>: <message>`.
function contractProblems(
  contracts: Record<string, string>,
): Record<string, string[]> {
  const files = new Map<string, string>([
    [`${FOLDER}/kit.d.ts`, readFileSync(KIT_FILE, 'utf8')],
  ]);
  const problems: Record<string, string[]> = {};
  for (const [owner, text] of Object.entries(contracts)) {
    const userText = userLayoutTypes(text);
    files.set(`${FOLDER}/${owner}/layout.d.ts`, userText);
    problems[owner] = ts
      .preProcessFile(userText, true, true)
      .importedFiles.map((imported) => imported.fileName)
      .filter(
        (specifier) =>
          specifier.startsWith('.') && specifier !== USER_KIT_SPECIFIER,
      )
      .map((specifier) => `imports ${specifier}, not only the kit`);
  }
  const options: ts.CompilerOptions = {
    noEmit: true,
    skipLibCheck: false,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'],
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (file) => files.has(file) || ts.sys.fileExists(file);
  host.readFile = (file) => files.get(file) ?? ts.sys.readFile(file);
  host.directoryExists = (folder) =>
    folder === FOLDER ||
    folder.startsWith(`${FOLDER}/`) ||
    ts.sys.directoryExists(folder);
  host.getSourceFile = (file, version, onError) => {
    const text = files.get(file);
    return text === undefined
      ? getSourceFile(file, version, onError)
      : ts.createSourceFile(file, text, version);
  };
  const program = ts.createProgram([...files.keys()], options, host);
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    const file = diagnostic.file?.fileName ?? '';
    const owner = file.slice(FOLDER.length + 1).split('/')[0];
    const message = ts.flattenDiagnosticMessageText(
      diagnostic.messageText,
      ' ',
    );
    (problems[owner] ??= []).push(`TS${diagnostic.code}: ${message}`);
  }
  return problems;
}

describe('layout contracts in the user folder', () => {
  it('every owner contract type-checks beside kit.d.ts', () => {
    const contracts = ownerContracts();

    const problems = contractProblems(contracts);

    expect(Object.keys(contracts)).toContain('shell');
    expect(problems).toEqual(
      Object.fromEntries(Object.keys(contracts).map((owner) => [owner, []])),
    );
  });

  it.each([
    {
      row: 'a kit member clashing with BaseKit',
      text: `import type { BaseKit } from '../../../shared/page/layout-host/kit';
export interface HelpKit extends BaseKit {
  section(parent: HTMLElement, section: { title: string }): HTMLElement;
}`,
      problem: 'TS2430',
    },
    {
      row: 'a relative import beside the kit',
      text: `import type { Layout } from '../docs/layout';
export type Mine = Layout;`,
      problem: 'imports ../docs/layout, not only the kit',
    },
  ])('a contract is flagged: $row', ({ text, problem }) => {
    const problems = contractProblems({ clash: text });

    expect(problems.clash.join('\n')).toContain(problem);
  });
});
