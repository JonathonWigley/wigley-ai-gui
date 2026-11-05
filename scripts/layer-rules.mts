// The plugin layer rules `check-layers.mts` enforces: each plugin's entries,
// derived from the plugin folder convention and its manifest's `dependsOn` and
// `reads`, and the check of the composition roots. Pure functions over folder
// facts and source text, so the rules are tested without walking `src/`.
import ts from 'typescript';

export interface LayerRule {
  layers: string[];
  // A package name, or a prefix ending in `:` such as `node:`.
  packages: string[];
}

export interface PluginFolder {
  // The folder name under src/plugins.
  id: string;
  hasContract: boolean;
  hasMain: boolean;
  hasPage: boolean;
  hasLayouts: boolean;
  dependsOn: { main: readonly string[]; page: readonly string[] };
  reads: { main: readonly string[]; page: readonly string[] };
}

// What the convention cannot show. Each part is appended to the derived entry
// of that folder kind; `sublayers` are whole entries, keyed by path.
export interface PluginExtra {
  root?: Partial<LayerRule>;
  contract?: Partial<LayerRule>;
  main?: Partial<LayerRule>;
  page?: Partial<LayerRule>;
  sublayers?: Record<string, LayerRule>;
}

const SHARED_TO_EVERY_PLUGIN = [
  'src/contracts',
  'src/shared',
  'src/shared/paths',
  'src/shared/followups',
];
const LAYOUT_HOST = 'src/shared/page/layout-host';
const SHARED_TO_EVERY_PAGE = [
  'src/shared/page',
  'src/shared/page/ui',
  LAYOUT_HOST,
  'src/shared/page/file-drop',
];

// An expression with any `as` or `satisfies` around it taken off.
function unwrapped(expression: ts.Expression): ts.Expression {
  let inner = expression;
  while (ts.isAsExpression(inner) || ts.isSatisfiesExpression(inner)) {
    inner = inner.expression;
  }
  return inner;
}

function firstDefinePluginCall(
  sourceFile: ts.SourceFile,
): ts.CallExpression | undefined {
  const pending: ts.Node[] = [sourceFile];
  for (let node = pending.pop(); node; node = pending.pop()) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'definePlugin'
    ) {
      return node;
    }
    const children: ts.Node[] = [];
    ts.forEachChild(node, (child) => {
      children.push(child);
    });
    pending.push(...children.reverse());
  }
  return undefined;
}

function propertyValue(
  literal: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined {
  for (const property of literal.properties) {
    if (ts.isPropertyAssignment(property) && property.name.getText() === name) {
      return property.initializer;
    }
  }
  return undefined;
}

// The strings of an array of string literals, or undefined for any other node.
function stringLiterals(expression: ts.Expression): string[] | undefined {
  const array = unwrapped(expression);
  if (!ts.isArrayLiteralExpression(array)) {
    return undefined;
  }
  const strings: string[] = [];
  for (const element of array.elements) {
    if (!ts.isStringLiteral(element)) {
      return undefined;
    }
    strings.push(element.text);
  }
  return strings;
}

function processLists(
  value: ts.Expression | undefined,
): { main: string[]; page: string[] } | undefined {
  const literal = value && unwrapped(value);
  if (
    !literal ||
    !ts.isObjectLiteralExpression(literal) ||
    !literal.properties.every(ts.isPropertyAssignment)
  ) {
    return undefined;
  }
  const mainValue = propertyValue(literal, 'main');
  const pageValue = propertyValue(literal, 'page');
  const main = mainValue && stringLiterals(mainValue);
  const page = pageValue && stringLiterals(pageValue);
  return main && page ? { main, page } : undefined;
}

// The per-process lists under `member` in the definePlugin call in `source`;
// throws when they are not an object literal of string-literal arrays.
function readManifestLists(
  file: string,
  source: string,
  member: 'dependsOn' | 'reads',
): { main: string[]; page: string[] } {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const manifest = firstDefinePluginCall(sourceFile)?.arguments[0];
  if (!manifest || !ts.isObjectLiteralExpression(manifest)) {
    throw new Error(`${file}: no definePlugin({ … }) call`);
  }
  const lists = processLists(propertyValue(manifest, member));
  if (!lists) {
    throw new Error(
      `${file}: ${member} must be an object literal with main and page arrays of string literals`,
    );
  }
  return lists;
}

export function readDependsOn(
  file: string,
  source: string,
): { main: string[]; page: string[] } {
  return readManifestLists(file, source, 'dependsOn');
}

export function readReads(
  file: string,
  source: string,
): { main: string[]; page: string[] } {
  return readManifestLists(file, source, 'reads');
}

function requireKnownNames(
  folders: readonly PluginFolder[],
  extras: Readonly<Record<string, PluginExtra>>,
): void {
  const ids = new Set(folders.map((folder) => folder.id));
  for (const key of Object.keys(extras)) {
    if (!ids.has(key)) {
      throw new Error(`PLUGIN_EXTRAS names ${key}, which is no plugin folder`);
    }
  }
  for (const { id, dependsOn, reads } of folders) {
    for (const [member, lists] of [
      ['dependsOn', dependsOn],
      ['reads', reads],
    ] as const) {
      for (const other of [...lists.main, ...lists.page]) {
        if (!ids.has(other)) {
          throw new Error(
            `${id}: ${member} names ${other}, which is no plugin folder`,
          );
        }
      }
    }
  }
}

function requireExtraPartsExist(
  { id, hasContract, hasMain, hasPage }: PluginFolder,
  extra: PluginExtra,
): void {
  const absentPart = [
    { part: 'contract', isAbsent: extra.contract && !hasContract },
    { part: 'main', isAbsent: extra.main && !hasMain },
    { part: 'page', isAbsent: extra.page && !hasPage },
  ].find(({ isAbsent }) => isAbsent);
  if (absentPart) {
    throw new Error(
      `PLUGIN_EXTRAS adds to ${id}'s ${absentPart.part}, which it lacks`,
    );
  }
}

function withExtra(
  derived: readonly string[],
  extra: Partial<LayerRule> | undefined,
): LayerRule {
  return {
    layers: [...new Set([...derived, ...(extra?.layers ?? [])])],
    packages: [...new Set(extra?.packages ?? [])],
  };
}

function folderEntries(
  folder: PluginFolder,
  contractsOf: (ids: readonly string[]) => string[],
  extra: PluginExtra,
): Record<string, LayerRule> {
  requireExtraPartsExist(folder, extra);
  const root = `src/plugins/${folder.id}`;
  const main = [...folder.dependsOn.main, ...folder.reads.main];
  const page = [...folder.dependsOn.page, ...folder.reads.page];
  const everyDependency = contractsOf([...new Set([...main, ...page])]);
  const ownContract = contractsOf([folder.id]);
  const ownLayers = [
    root,
    ...ownContract,
    ...(folder.hasLayouts ? [`${root}/layouts`] : []),
  ];
  const entries: Record<string, LayerRule> = {
    [root]: withExtra(
      [...SHARED_TO_EVERY_PLUGIN, ...ownContract, ...everyDependency],
      extra.root,
    ),
    ...extra.sublayers,
  };
  if (folder.hasContract) {
    entries[`${root}/contract.ts`] = withExtra(
      ['src/contracts', ...everyDependency],
      extra.contract,
    );
  }
  if (folder.hasMain) {
    entries[`${root}/main`] = withExtra(
      [...SHARED_TO_EVERY_PLUGIN, ...ownLayers, ...contractsOf(main)],
      extra.main,
    );
  }
  if (folder.hasPage) {
    entries[`${root}/page`] = withExtra(
      [
        ...SHARED_TO_EVERY_PLUGIN,
        ...SHARED_TO_EVERY_PAGE,
        ...ownLayers,
        ...contractsOf(page),
      ],
      extra.page,
    );
  }
  if (folder.hasLayouts) {
    entries[`${root}/layouts`] = { layers: [LAYOUT_HOST], packages: [] };
  }
  return entries;
}

// Every plugin entry and the entries of src/plugins/main.ts, page.ts and
// manifests.ts. Throws at the first `dependsOn` name, `reads` name or extras key
// that names no folder, and at an extra for a part its folder lacks.
export function pluginLayers(
  folders: readonly PluginFolder[],
  extras: Readonly<Record<string, PluginExtra>>,
): Record<string, LayerRule> {
  requireKnownNames(folders, extras);
  const sorted = [...folders].sort((a, b) => (a.id < b.id ? -1 : 1));
  const idsWithContract = new Set(
    sorted.filter((folder) => folder.hasContract).map((folder) => folder.id),
  );
  const contractsOf = (ids: readonly string[]): string[] =>
    ids
      .filter((id) => idsWithContract.has(id))
      .map((id) => `src/plugins/${id}/contract.ts`);
  const entries: Record<string, LayerRule> = {};
  for (const folder of sorted) {
    Object.assign(
      entries,
      folderEntries(folder, contractsOf, extras[folder.id] ?? {}),
    );
  }
  const rootAndPart = ({ id }: PluginFolder, part: string): string[] => [
    `src/plugins/${id}`,
    `src/plugins/${id}/${part}`,
  ];
  entries['src/plugins/main.ts'] = {
    layers: [
      'src/contracts',
      'src/shared',
      ...sorted
        .filter((folder) => folder.hasMain)
        .flatMap((folder) => rootAndPart(folder, 'main')),
    ],
    packages: [],
  };
  entries['src/plugins/page.ts'] = {
    layers: [
      'src/contracts',
      'src/shared',
      'src/shared/page',
      ...sorted
        .filter((folder) => folder.hasPage)
        .flatMap((folder) => rootAndPart(folder, 'page')),
    ],
    packages: [],
  };
  entries['src/plugins/manifests.ts'] = {
    layers: [
      'src/contracts',
      'src/shared',
      ...sorted.map(({ id }) => `src/plugins/${id}`),
    ],
    packages: [],
  };
  return entries;
}

function exportedArray(
  sourceFile: ts.SourceFile,
  arrayName: string,
): ts.ArrayLiteralExpression | undefined {
  for (const statement of sourceFile.statements) {
    const isExported =
      ts.isVariableStatement(statement) &&
      statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      );
    if (!isExported) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      const initializer =
        declaration.initializer && unwrapped(declaration.initializer);
      if (
        declaration.name.getText() === arrayName &&
        initializer &&
        ts.isArrayLiteralExpression(initializer)
      ) {
        return initializer;
      }
    }
  }
  return undefined;
}

// The module specifier of each name the file's named imports bind.
function namedImports(sourceFile: ts.SourceFile): Map<string, string> {
  const specifiers = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (
      bindings &&
      ts.isNamedImports(bindings) &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      for (const element of bindings.elements) {
        specifiers.set(element.name.text, statement.moduleSpecifier.text);
      }
    }
  }
  return specifiers;
}

// One line per part `expected` names that the array `arrayName` in `source`
// misses, lists twice, or holds beside them. Throws when `source` exports no
// array named `arrayName`.
export function compositionFailures(
  file: string,
  source: string,
  arrayName: string,
  expected: readonly string[],
): string[] {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const array = exportedArray(sourceFile, arrayName);
  if (!array) {
    throw new Error(`${file}: no exported array ${arrayName}`);
  }
  const imports = namedImports(sourceFile);
  const failures: string[] = [];
  const listedCounts = new Map<string, number>();
  for (const element of array.elements) {
    const specifier = ts.isIdentifier(element)
      ? imports.get(element.text)
      : undefined;
    if (specifier === undefined) {
      failures.push(
        `${file}: ${arrayName} holds ${element.getText()}, which no import names`,
      );
    } else {
      listedCounts.set(specifier, (listedCounts.get(specifier) ?? 0) + 1);
    }
  }
  for (const part of expected) {
    if (!listedCounts.has(part)) {
      failures.push(`${file}: ${arrayName} misses ${part}`);
    }
  }
  for (const [specifier, count] of listedCounts) {
    if (!expected.includes(specifier)) {
      failures.push(
        `${file}: ${arrayName} lists ${specifier}, which is no plugin folder's part`,
      );
    } else if (count > 1) {
      failures.push(`${file}: ${arrayName} lists ${specifier} twice`);
    }
  }
  return failures;
}
