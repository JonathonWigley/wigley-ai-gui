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
import { keymapRows } from './keymap-rows';
import { keymapSection, keyRowInput } from './keymap-view';
import type { PickRequest, RowContext } from './settings-view';

type BoxRequest = Parameters<RowContext['openBox']>[0];
type RowBox = Parameters<RowContext['closeBox']>[0];

function command(id: string, runsIn: 'page' | 'main' = 'page'): CommandInfo {
  const [plugin] = id.split('.');
  return { id, plugin, label: `${id} label`, group: 'g', runsIn };
}

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
    ...overrides,
  };
}

describe('keymapSection', () => {
  it.each([
    { query: '', isShown: true },
    { query: '   ', isShown: true },
    { query: 'zzz', isShown: false },
  ])('advanced row with filter "$query" → $isShown', ({ query, isShown }) => {
    const { rows } = keymapSection(context(schema([], []), {}), query);

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

  // The row of argument 2 over `layer`, with each commit, box and picker kept.
  function secondRow() {
    const committed: UserKeymap[] = [];
    const boxes: BoxRequest[] = [];
    const pickers: PickRequest<ViewScope>[] = [];
    const ctx = context(pickSchema, layer, {
      commitKeymap: (written) => committed.push(written),
      openBox: (box) => boxes.push(box),
      openPicker: <T>(picker: PickRequest<T>) =>
        pickers.push(picker as unknown as PickRequest<ViewScope>),
    });
    const { rows } = keymapSection(ctx, '');
    const row = rows.find((each) => each.key === 'p.pick 2');
    if (row === undefined) {
      throw new Error(`no p.pick 2 in ${rows.map((each) => each.key).join()}`);
    }
    return { row, committed, boxes, pickers };
  }

  it('reset writes back only the binds of the other arguments', () => {
    const { row, committed } = secondRow();

    row.actions.reset?.();

    expect(committed).toEqual([{ binds: [bind('a', 1)] }]);
  });

  it('addBind opens its box under the row key and writes the bind with its argument', () => {
    const { row, committed, boxes, pickers } = secondRow();

    row.actions.addBind?.();
    expect(boxes.map((box) => box.key)).toEqual([row.key]);
    boxes[0].accept({ text: () => ' z ' } as RowBox);
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
  const lines = (id: string) =>
    keyRowInput(
      ctx,
      rows.find((row) => row.command.id === id)!,
    ).lines.map(({ kind, tags, isStruck }) => ({ kind, tags, isStruck }));

  it.each([
    {
      case: 'a default bind in scope any',
      id: 'p.a',
      expected: [{ kind: 'bind', tags: ['Everywhere'], isStruck: false }],
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
  });
});
