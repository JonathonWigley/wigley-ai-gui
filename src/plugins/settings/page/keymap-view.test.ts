import { describe, expect, it } from 'vitest';
import { fakeFuzzyMatcher } from '../../../shared/fake-fuzzy-matcher.test-support';
import type {
  AcceleratorBind,
  KeyBind,
  UserKeymap,
  ViewScope,
} from '../../../contracts/keymap';
import type { CommandInfo } from '../../../contracts/plugin';
import type { UserConfigSchema } from '../../../contracts/user-config';
import type { RecordRequest } from './key-recorder';
import { type BindLine, keymapRows } from './keymap-rows';
import { keymapSection, keyRowInput, type KeysViewState } from './keymap-view';
import type { PickRequest, RowContext, SectionDrawing } from './settings-view';

type BoxRequest = Parameters<RowContext['openBox']>[0];

function command(id: string, runsIn: 'page' | 'main' = 'page'): CommandInfo {
  const [plugin] = id.split('.');
  return { id, plugin, label: `${id} label`, group: `${id} group`, runsIn };
}

const NO_FILTER: KeysViewState = { filter: 'all', findKeys: null };

function schema(defaultBinds: KeyBind[], app: AcceleratorBind[]) {
  return {
    sections: [],
    commands: {
      'p.a': command('p.a'),
      'p.b': command('p.b'),
      'p.c': command('p.c'),
      'p.d': command('p.d'),
      'p.e': command('p.e'),
      'p.menu': command('p.menu', 'main'),
    },
    scopes: [{ id: 'p.s', title: 'In p', plugin: 'p' }],
    defaultBindLayers: [defaultBinds],
    defaultAccelerators: { app, global: [], intercept: [] },
    defaultLeader: '<Space>',
  } satisfies UserConfigSchema;
}

// A row context over the schema and keymap layer; beyond `overrides`, it reads
// nothing else.
function context(
  given: UserConfigSchema,
  layer: UserKeymap,
  overrides: Partial<RowContext> = {},
): RowContext {
  const unread = () => {
    throw new Error('not read by keyRowInput');
  };
  return {
    schema: given,
    platform: 'macos',
    read: unread,
    settingsLayer: unread,
    keymapLayer: () => layer,
    matcher: fakeFuzzyMatcher,
    openBox: unread,
    closeBox: unread,
    boxProblem: unread,
    openPicker: unread,
    commitSettings: unread,
    commitKeymap: unread,
    toast: unread,
    plugins: unread,
    mayDisable: unread,
    refuse: unread,
    recordKey: unread,
    recording: () => null,
    ...overrides,
  };
}

describe('keymapSection', () => {
  it.each([
    { query: '', isShown: true },
    { query: '   ', isShown: true },
    { query: 'zzz', isShown: false },
  ])('advanced row with filter "$query" → $isShown', ({ query, isShown }) => {
    const { rows } = keymapSection(
      context(schema([], []), {}),
      query,
      NO_FILTER,
    );

    expect(rows.some((row) => row.key === 'advanced')).toBe(isShown);
  });
});

describe('a row of a command that takes an argument', () => {
  const PICK: CommandInfo = { ...command('p.pick'), arg: 'number' };
  const pickSchema = { ...schema([], []), commands: { 'p.pick': PICK } };
  const bind = (keys: string, arg: number): KeyBind => ({
    keys,
    scope: 'any',
    command: 'p.pick',
    arg,
  });
  const layer: UserKeymap = { binds: [bind('a', 1), bind('b', 2)] };

  // The row of argument 2 over `layer`, with each commit, recording and
  // picker kept.
  function secondRow() {
    const committed: UserKeymap[] = [];
    const recordings: RecordRequest[] = [];
    const pickers: PickRequest<ViewScope>[] = [];
    const ctx = context(pickSchema, layer, {
      commitKeymap: (written) => committed.push(written),
      recordKey: (request) => recordings.push(request),
      openPicker: <T>(picker: PickRequest<T>) =>
        pickers.push(picker as unknown as PickRequest<ViewScope>),
    });
    const { rows } = keymapSection(ctx, '', NO_FILTER);
    const row = rows.find((each) => each.key === 'p.pick 2');
    if (row === undefined) {
      throw new Error(`no p.pick 2 in ${rows.map((each) => each.key).join()}`);
    }
    return { row, committed, recordings, pickers };
  }

  it('reset writes back only the binds of the other arguments', () => {
    const { row, committed } = secondRow();

    row.actions.reset?.();

    expect(committed).toEqual([{ binds: [bind('a', 1)] }]);
  });

  it('addBind_RecordsThenScopePicker_WritesTheBindWithItsArgument', () => {
    const { row, committed, recordings, pickers } = secondRow();

    row.actions.addBind?.();
    expect(recordings.map((request) => request.key)).toEqual([row.key]);
    recordings[0].keep('z');
    expect(pickers.map((picker) => picker.title)).toEqual(['Scope']);
    pickers[0].chosen('any', null);

    expect(committed).toEqual([
      { binds: [bind('a', 1), bind('b', 2), bind('z', 2)] },
    ]);
  });
});

describe('keyRowInput', () => {
  const given = schema(
    [
      { keys: 'x', scope: 'any', command: 'p.a' },
      { keys: 'y', scope: 'p.s', command: 'p.b' },
    ],
    [{ accelerator: 'CommandOrControl+,', command: 'p.menu' }],
  );
  const layer: UserKeymap = {
    binds: [
      { keys: 'y', scope: 'p.s', command: 'p.d' },
      { keys: 'z', scope: 'p.s', command: 'p.c', where: 'box' },
    ],
    unbind: [{ app: 'CommandOrControl+,' }],
  };
  const ctx = context(given, layer);
  const rows = keymapRows(given, layer).flatMap((group) => group.rows);
  const input = (id: string) =>
    keyRowInput(
      ctx,
      rows.find((row) => row.command.id === id)!,
    );
  const lines = (id: string) =>
    input(id).lines.map(({ kind, tags, isStruck }) => ({
      kind,
      tags,
      isStruck,
    }));

  it.each([
    {
      case: 'a default bind in scope any',
      id: 'p.a',
      expected: [{ kind: 'bind', tags: [], isStruck: false }],
    },
    {
      case: "a user bind's where and Set",
      id: 'p.c',
      expected: [
        { kind: 'bind', tags: ['In p', 'box', 'Set'], isStruck: false },
      ],
    },
    {
      case: 'a default bind a user bind displaced',
      id: 'p.b',
      expected: [
        {
          kind: 'bind',
          tags: ['In p', 'Replaced by p.d label'],
          isStruck: true,
        },
      ],
    },
    {
      case: 'an unbound default app accelerator',
      id: 'p.menu',
      expected: [
        { kind: 'accelerator', tags: ['App menu', 'Removed'], isStruck: true },
      ],
    },
    { case: 'a command with no binds', id: 'p.e', expected: [] },
  ])('lists the lines of $case', ({ id, expected }) => {
    expect(lines(id)).toEqual(expected);
    expect(input(id).group).toBe(`${id} group`);
  });
});

// The rows' keys and the chip counts (all, bound, unbound, changed) of a
// drawing.
function shownKeys(drawing: SectionDrawing): string[] {
  return drawing.rows.map((row) => row.key);
}

function chipCounts(drawing: SectionDrawing): number[] {
  const bar = drawing.entries.find((entry) => entry.type === 'keyFilters');
  if (bar?.type !== 'keyFilters') {
    throw new Error('no keyFilters entry');
  }
  return bar.input.chips.map((chip) => chip.count);
}

describe('keymapSection filters', () => {
  // p.a fires; p.b's default p.d's user bind replaced; p.c and p.d hold user
  // binds; p.e holds nothing; p.menu's accelerator is removed.
  const given = schema(
    [
      { keys: 'x', scope: 'any', command: 'p.a' },
      { keys: 'y', scope: 'p.s', command: 'p.b' },
    ],
    [{ accelerator: 'CommandOrControl+,', command: 'p.menu' }],
  );
  const layer: UserKeymap = {
    binds: [
      { keys: 'y', scope: 'p.s', command: 'p.d' },
      { keys: 'z', scope: 'p.s', command: 'p.c', where: 'box' },
    ],
    unbind: [{ app: 'CommandOrControl+,' }],
  };
  const ctx = context(given, layer);

  it.each([
    {
      filter: 'all',
      keys: ['leader', 'p.a', 'p.b', 'p.c', 'p.d', 'p.e', 'p.menu', 'advanced'],
    },
    { filter: 'bound', keys: ['p.a', 'p.c', 'p.d'] },
    { filter: 'unbound', keys: ['p.b', 'p.e', 'p.menu'] },
    { filter: 'changed', keys: ['p.c', 'p.d', 'p.menu'] },
  ] as const)(
    'keymapSection_KeyFilter_RowsShown: $filter',
    ({ filter, keys }) => {
      const drawing = keymapSection(ctx, '', { filter, findKeys: null });

      expect(shownKeys(drawing)).toEqual(keys);
    },
  );

  it.each([
    { case: 'no query', query: '', findKeys: null, counts: [6, 3, 3, 3] },
    { case: 'a / query', query: 'z', findKeys: null, counts: [1, 1, 0, 1] },
    { case: 'a find query', query: '', findKeys: 'x', counts: [1, 1, 0, 0] },
  ])('keymapSection_ChipCounts: $case', ({ query, findKeys, counts }) => {
    const drawing = keymapSection(ctx, query, { filter: 'bound', findKeys });

    expect(chipCounts(drawing)).toEqual(counts);
  });

  it('keymapSection_FindByKey_HeadersAndRows', () => {
    const found = context(
      schema(
        [
          { keys: 'j', scope: 'any', command: 'p.a' },
          { keys: 'jk', scope: 'p.s', command: 'p.b' },
          { keys: 'k', scope: 'any', command: 'p.c' },
        ],
        [],
      ),
      {},
    );

    const drawing = keymapSection(found, '', { filter: 'all', findKeys: 'j' });

    expect(
      drawing.entries.map((entry) =>
        entry.type === 'row'
          ? entry.row.key
          : entry.type === 'header'
            ? `header ${entry.input.title}`
            : entry.type,
      ),
    ).toEqual([
      'keyFilters',
      'header j runs',
      'p.a',
      'header Starts with j',
      'p.b',
    ]);
  });
});

describe('reassign', () => {
  // p.a holds `x` everywhere, p.b `<A-o>` everywhere, p.c `q` and `w`.
  const given = schema(
    [
      { keys: 'x', scope: 'any', command: 'p.a' },
      { keys: '<A-o>', scope: 'any', command: 'p.b' },
      { keys: 'q', scope: 'any', command: 'p.c' },
      { keys: 'w', scope: 'p.s', command: 'p.c' },
    ],
    [],
  );

  // Enter on `id`'s row, with each recording, commit, box and picker kept.
  function reassigned(id: string) {
    const recordings: RecordRequest[] = [];
    const committed: UserKeymap[] = [];
    const boxes: BoxRequest[] = [];
    const pickers: PickRequest<BindLine>[] = [];
    const ctx = context(
      given,
      {},
      {
        recordKey: (request) => recordings.push(request),
        commitKeymap: (written) => committed.push(written),
        openBox: (box) => boxes.push(box),
        openPicker: <T>(picker: PickRequest<T>) =>
          pickers.push(picker as unknown as PickRequest<BindLine>),
      },
    );
    const row = keymapSection(ctx, '', NO_FILTER).rows.find(
      (each) => each.key === id,
    );
    row?.actions.open?.();
    return { recordings, committed, boxes, pickers };
  }

  it.each([
    {
      case: 'one bind commits the move',
      id: 'p.a',
      act: (shown: ReturnType<typeof reassigned>) => {
        shown.recordings[0].keep('t');
        return shown.committed;
      },
      expected: [
        {
          unbind: [{ keys: 'x', scope: 'any' }],
          binds: [{ keys: 't', scope: 'any', command: 'p.a' }],
        },
      ],
    },
    {
      case: 'the keys it holds write nothing',
      id: 'p.a',
      act: (shown: ReturnType<typeof reassigned>) => {
        shown.recordings[0].keep('x');
        return shown.committed;
      },
      expected: [],
    },
    {
      case: 'taken keys move here',
      id: 'p.a',
      act: (shown: ReturnType<typeof reassigned>) =>
        shown.recordings[0].judge('<A-o>'),
      expected: {
        type: 'moves',
        note: '⌥O runs "p.b label" everywhere: it moves here',
        from: ['p.b'],
      },
    },
    {
      case: 'the leader is refused',
      id: 'p.a',
      act: (shown: ReturnType<typeof reassigned>) =>
        shown.recordings[0].judge('<Space>'),
      expected: {
        type: 'refused',
        note: 'Space is the leader — Tab types a leader sequence',
        reason: 'leader',
      },
    },
    {
      case: 'Tab opens the line box with the typed text',
      id: 'p.a',
      act: (shown: ReturnType<typeof reassigned>) => {
        shown.recordings[0].type?.('t');
        return shown.boxes.map((box) => [box.key, box.text]);
      },
      expected: [['p.a', 't']],
    },
    {
      case: 'several binds open the picker first',
      id: 'p.c',
      act: (shown: ReturnType<typeof reassigned>) => {
        const before = shown.recordings.length;
        shown.pickers[0].chosen(shown.pickers[0].items[1], null);
        return [
          shown.pickers.map((picker) => picker.title),
          before,
          shown.recordings.map((request) => request.replacing),
        ];
      },
      expected: [['Key to reassign'], 0, [1]],
    },
  ])('reassign_RecordRequest: $case', ({ id, act, expected }) => {
    expect(act(reassigned(id))).toEqual(expected);
  });
});
