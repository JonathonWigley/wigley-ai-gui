import { describe, expect, it } from 'vitest';
import {
  compositionFailures,
  pluginLayers,
  readDependsOn,
  readReads,
  type PluginExtra,
  type PluginFolder,
} from './layer-rules.mts';

const NOTES: PluginFolder = {
  id: 'notes',
  hasContract: true,
  hasMain: true,
  hasPage: true,
  hasLayouts: true,
  dependsOn: { main: ['chat', 'keys'], page: ['keys'] },
  reads: { main: [], page: [] },
};
const CHAT: PluginFolder = {
  id: 'chat',
  hasContract: true,
  hasMain: true,
  hasPage: true,
  hasLayouts: false,
  dependsOn: { main: [], page: [] },
  reads: { main: [], page: [] },
};
const KEYS: PluginFolder = {
  id: 'keys',
  hasContract: false,
  hasMain: false,
  hasPage: true,
  hasLayouts: false,
  dependsOn: { main: [], page: [] },
  reads: { main: [], page: [] },
};
const FOLDERS = [NOTES, CHAT, KEYS];
const MAIN_ONLY: PluginFolder = {
  id: 'mainOnly',
  hasContract: false,
  hasMain: true,
  hasPage: false,
  hasLayouts: false,
  dependsOn: { main: [], page: [] },
  reads: { main: [], page: [] },
};

const SHARED = [
  'src/contracts',
  'src/shared',
  'src/shared/paths',
  'src/shared/followups',
];
const SHARED_PAGE = [
  'src/shared/page',
  'src/shared/page/ui',
  'src/shared/page/layout-host',
  'src/shared/page/file-drop',
];

describe('pluginLayers', () => {
  it.each([
    {
      layer: 'src/plugins/notes',
      layers: [
        ...SHARED,
        'src/plugins/notes/contract.ts',
        'src/plugins/chat/contract.ts',
      ],
    },
    {
      layer: 'src/plugins/notes/contract.ts',
      layers: ['src/contracts', 'src/plugins/chat/contract.ts'],
    },
    {
      layer: 'src/plugins/notes/main',
      layers: [
        ...SHARED,
        'src/plugins/notes',
        'src/plugins/notes/contract.ts',
        'src/plugins/notes/layouts',
        'src/plugins/chat/contract.ts',
      ],
    },
    {
      layer: 'src/plugins/notes/page',
      layers: [
        ...SHARED,
        ...SHARED_PAGE,
        'src/plugins/notes',
        'src/plugins/notes/contract.ts',
        'src/plugins/notes/layouts',
      ],
    },
    {
      layer: 'src/plugins/notes/layouts',
      layers: ['src/shared/page/layout-host'],
    },
    {
      layer: 'src/plugins/main.ts',
      layers: [
        'src/contracts',
        'src/shared',
        'src/plugins/chat',
        'src/plugins/chat/main',
        'src/plugins/notes',
        'src/plugins/notes/main',
      ],
    },
    {
      layer: 'src/plugins/page.ts',
      layers: [
        'src/contracts',
        'src/shared',
        'src/shared/page',
        'src/plugins/chat',
        'src/plugins/chat/page',
        'src/plugins/keys',
        'src/plugins/keys/page',
        'src/plugins/notes',
        'src/plugins/notes/page',
      ],
    },
    {
      layer: 'src/plugins/manifests.ts',
      layers: [
        'src/contracts',
        'src/shared',
        'src/plugins/chat',
        'src/plugins/keys',
        'src/plugins/notes',
      ],
    },
  ])('pluginLayers_DerivedEntry_$layer', ({ layer, layers }) => {
    expect(pluginLayers(FOLDERS, {})[layer]).toEqual({ layers, packages: [] });
  });

  it.each([
    {
      layer: 'src/plugins/chat/main',
      layers: [...SHARED, 'src/plugins/chat', 'src/plugins/chat/contract.ts'],
    },
    {
      layer: 'src/plugins/keys/page',
      layers: [...SHARED, ...SHARED_PAGE, 'src/plugins/keys'],
    },
  ])('pluginLayers_EntryWithoutAPart_$layer', ({ layer, layers }) => {
    expect(pluginLayers(FOLDERS, {})[layer]).toEqual({ layers, packages: [] });
  });

  it('pluginLayers_PartAFolderLacks_HasNoEntry', () => {
    const layers = Object.keys(pluginLayers(FOLDERS, {}));
    expect(layers).not.toContain('src/plugins/keys/main');
    expect(layers).not.toContain('src/plugins/keys/contract.ts');
    expect(layers).not.toContain('src/plugins/chat/layouts');
  });

  it('pluginLayers_Extras_AppendToTheEntryAndAddSublayers', () => {
    const sublayer = { layers: ['src/contracts'], packages: [] };
    const entries = pluginLayers(FOLDERS, {
      notes: {
        main: {
          layers: ['src/shared', 'src/shared/agent-forms'],
          packages: ['node:'],
        },
        sublayers: { 'src/plugins/notes/main/x': sublayer },
      },
    });
    expect(entries['src/plugins/notes/main']).toEqual({
      layers: [
        ...SHARED,
        'src/plugins/notes',
        'src/plugins/notes/contract.ts',
        'src/plugins/notes/layouts',
        'src/plugins/chat/contract.ts',
        'src/shared/agent-forms',
      ],
      packages: ['node:'],
    });
    expect(entries['src/plugins/notes/main/x']).toEqual(sublayer);
  });

  it.each<{
    case: string;
    folders: PluginFolder[];
    extras: Record<string, PluginExtra>;
    message: string;
  }>([
    {
      case: 'extras key',
      folders: FOLDERS,
      extras: { ghost: {} },
      message: 'PLUGIN_EXTRAS names ghost, which is no plugin folder',
    },
    {
      case: 'dependency',
      folders: [
        { ...NOTES, dependsOn: { main: ['ghost'], page: [] } },
        CHAT,
        KEYS,
      ],
      extras: {},
      message: 'notes: dependsOn names ghost, which is no plugin folder',
    },
    {
      case: 'reads',
      folders: [{ ...NOTES, reads: { main: [], page: ['ghost'] } }, CHAT, KEYS],
      extras: {},
      message: 'notes: reads names ghost, which is no plugin folder',
    },
  ])(
    'pluginLayers_NamesNoFolder_Throws: $case',
    ({ folders, extras, message }) => {
      expect(() => pluginLayers(folders, extras)).toThrow(message);
    },
  );

  it.each([
    {
      id: 'keys',
      part: 'contract',
      extra: { contract: { layers: ['src/shared'] } },
    },
    { id: 'keys', part: 'main', extra: { main: { packages: ['node:'] } } },
    {
      id: 'mainOnly',
      part: 'page',
      extra: { page: { layers: ['src/shared'] } },
    },
  ])(
    'pluginLayers_ExtraForAnAbsentPart_Throws: $id $part',
    ({ id, part, extra }) => {
      expect(() =>
        pluginLayers([...FOLDERS, MAIN_ONLY], { [id]: extra }),
      ).toThrow(`PLUGIN_EXTRAS adds to ${id}'s ${part}, which it lacks`);
    },
  );
});

describe('pluginLayers reads', () => {
  const ROOT = 'src/plugins/reader';
  const OWNER: PluginFolder = {
    id: 'owner',
    hasContract: true,
    hasMain: true,
    hasPage: true,
    hasLayouts: false,
    dependsOn: { main: [], page: [] },
    reads: { main: [], page: [] },
  };
  const OWNER_CONTRACT = 'src/plugins/owner/contract.ts';

  it.each([
    { member: 'main', has: 'main', hasNot: 'page' },
    { member: 'page', has: 'page', hasNot: 'main' },
  ] as const)(
    'pluginLayers_Reads_GivesThatLayerTheContractOnly: $member',
    ({ member, has, hasNot }) => {
      const reader: PluginFolder = {
        ...OWNER,
        id: 'reader',
        reads: { main: [], page: [], [member]: ['owner'] },
      };

      const entries = pluginLayers([reader, OWNER], {});

      expect(entries[`${ROOT}/${has}`].layers).toContain(OWNER_CONTRACT);
      expect(entries[`${ROOT}/${hasNot}`].layers).not.toContain(OWNER_CONTRACT);
      expect(entries[ROOT].layers).toContain(OWNER_CONTRACT);
      expect(entries[`${ROOT}/contract.ts`].layers).toContain(OWNER_CONTRACT);
    },
  );
});

describe.each([
  { member: 'dependsOn', read: readDependsOn },
  { member: 'reads', read: readReads },
])('$member reader', ({ member, read }) => {
  const FILE = 'src/plugins/notes/manifest.ts';
  const manifest = (property: string): string =>
    `export const m = definePlugin({ id: 'notes', ${property}, commands: {} });`;

  it.each([
    { case: 'Literal', lists: "{ main: ['chat'], page: [] }" },
    { case: 'AsConst', lists: "{ main: ['chat'], page: [] } as const" },
    { case: 'ArrayAsConst', lists: "{ main: ['chat'] as const, page: [] }" },
  ])('read_$case', ({ lists }) => {
    expect(read(FILE, manifest(`${member}: ${lists}`))).toEqual({
      main: ['chat'],
      page: [],
    });
  });

  it.each([
    { case: 'Identifier', property: `${member}: LISTS` },
    { case: 'FlatArray', property: `${member}: ['chat']` },
    { case: 'Spread', property: `${member}: { main: [...SHARED], page: [] }` },
    {
      case: 'SpreadProperty',
      property: `${member}: { ...SHARED, main: ['chat'], page: [] }`,
    },
    { case: 'NoPage', property: `${member}: { main: ['chat'] }` },
    { case: 'Absent', property: "label: 'notes'" },
  ])('read_$case', ({ property }) => {
    expect(() => read(FILE, manifest(property))).toThrow(
      `${FILE}: ${member} must be an object literal with main and page arrays of string literals`,
    );
  });

  it.each([
    { case: 'NoDefinePlugin', source: 'export const m = {}' },
    { case: 'ArgumentNotALiteral', source: 'export const m = definePlugin(x)' },
  ])('read_$case', ({ source }) => {
    expect(() => read(FILE, source)).toThrow(
      `${FILE}: no definePlugin({ … }) call`,
    );
  });
});

describe('compositionFailures', () => {
  const FILE = 'src/plugins/main.ts';
  const EXPECTED = ['./chat/main/start', './notes/main/start'];
  const CHAT_IMPORT = "import { chatMainPart } from './chat/main/start';";
  const NOTES_IMPORT = "import { notesMainPart } from './notes/main/start';";
  const BOTH_IMPORTS = `${CHAT_IMPORT}\n${NOTES_IMPORT}`;
  const parts = (imports: string, elements: string): string =>
    `${imports}\nexport const mainParts: readonly MainPart[] = [${elements}];`;

  it.each([
    {
      case: 'Complete',
      source: parts(BOTH_IMPORTS, 'chatMainPart, notesMainPart'),
      failures: [],
    },
    {
      case: 'CompleteAsConst',
      source: `${BOTH_IMPORTS}\nexport const mainParts = [chatMainPart, notesMainPart] as const;`,
      failures: [],
    },
    {
      case: 'MissesAFolder',
      source: parts(CHAT_IMPORT, 'chatMainPart'),
      failures: ['src/plugins/main.ts: mainParts misses ./notes/main/start'],
    },
    {
      case: 'ListsOneTwice',
      source: parts(BOTH_IMPORTS, 'chatMainPart, notesMainPart, chatMainPart'),
      failures: [
        'src/plugins/main.ts: mainParts lists ./chat/main/start twice',
      ],
    },
    {
      case: 'ListsNoPart',
      source: parts(
        `${BOTH_IMPORTS}\nimport { ghostMainPart } from './ghost/main/start';`,
        'chatMainPart, notesMainPart, ghostMainPart',
      ),
      failures: [
        "src/plugins/main.ts: mainParts lists ./ghost/main/start, which is no plugin folder's part",
      ],
    },
    {
      case: 'UnimportedElement',
      source: parts(BOTH_IMPORTS, 'chatMainPart, notesMainPart, strayPart'),
      failures: [
        'src/plugins/main.ts: mainParts holds strayPart, which no import names',
      ],
    },
    {
      case: 'SpreadElement',
      source: parts(BOTH_IMPORTS, 'chatMainPart, notesMainPart, ...extra'),
      failures: [
        'src/plugins/main.ts: mainParts holds ...extra, which no import names',
      ],
    },
  ])('compositionFailures_$case', ({ source, failures }) => {
    expect(compositionFailures(FILE, source, 'mainParts', EXPECTED)).toEqual(
      failures,
    );
  });

  it.each([
    { case: 'Absent', source: 'export const otherParts = [];' },
    { case: 'NotExported', source: 'const mainParts = [];' },
  ])('compositionFailures_ArrayMissing_$case', ({ source }) => {
    expect(() =>
      compositionFailures(FILE, source, 'mainParts', EXPECTED),
    ).toThrow('src/plugins/main.ts: no exported array mainParts');
  });
});
