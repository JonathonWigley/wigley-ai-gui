import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewScope } from '../../../contracts/keymap';
import { asFake, asHtml, FakeElement, installFakeDom } from '../test-dom';
import {
  type BaseKitDeps,
  commandRunner,
  createBaseKit,
  type KitCommands,
  ownerBaseKitDeps,
} from './base-kit';
import { recordingAnchors } from './test-layouts';

const BOUND: Record<string, string> = {
  'docs.open': 'Mod+O',
  'panes.focusLeft': 'Alt+H',
};

// A kit for owner `docs` whose only commands are `open` and `close`, with
// `Mod+O` bound to `docs.open` and `Alt+H` to `panes.focusLeft` in
// `docs.tree` alone, recording each anchor
// and each keys read.
function kitOver(scope: ViewScope | null) {
  const anchors: unknown[][] = [];
  const reads: unknown[][] = [];
  const deps: BaseKitDeps = {
    markdown: {
      block: (text) => `<p>${text}</p>`,
      inline: (text) => text,
      document: async (text) => text,
    },
    keys: {
      anchor(element, command, options) {
        anchors.push([asFake(element), command, options]);
        return { dispose: () => undefined };
      },
      keysFor(command, readScope) {
        reads.push([command, readScope]);
        return readScope === 'docs.tree' || readScope === undefined
          ? (BOUND[command] ?? null)
          : null;
      },
    },
    commands: {
      exists: (id) =>
        ['docs.open', 'docs.close', 'panes.focusLeft'].includes(id),
      run: () => undefined,
    },
    scope,
    commandNamed: (short) =>
      short === 'open' || short === 'close' ? `docs.${short}` : null,
    platform: 'macos',
  };
  return { kit: createBaseKit(deps), deps, anchors, reads };
}

describe('createBaseKit', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('commandRunner_UnknownId_ThrowsAtCreationAndRunsOnlyOnCall', () => {
    const ran: string[] = [];
    const commands: KitCommands = {
      exists: (id) => id === 'docs.open',
      run: (id) => ran.push(id),
    };

    expect(() => commandRunner('docs.nope', commands)).toThrow(
      'no command docs.nope',
    );
    const run = commandRunner('docs.open', commands);
    expect(ran).toEqual([]);
    run();
    run();
    expect(ran).toEqual(['docs.open', 'docs.open']);
  });

  it.each([
    {
      row: 'known short name',
      scope: 'docs.tree',
      command: 'open',
      options: undefined,
      className: '',
      anchored: [['docs.open', { scope: 'docs.tree' }]],
    },
    {
      row: "known name with label 'Open'",
      scope: 'docs.tree',
      command: 'open',
      options: { className: 'hint', label: 'Open' },
      className: 'hint',
      anchored: [['docs.open', { scope: 'docs.tree', label: 'Open' }]],
    },
    {
      row: 'unknown name',
      scope: 'docs.tree',
      command: 'nope',
      options: undefined,
      className: '',
      anchored: [],
    },
    {
      row: 'qualified id',
      scope: 'docs.tree',
      command: 'panes.focusLeft',
      options: undefined,
      className: '',
      anchored: [['panes.focusLeft', { scope: 'docs.tree' }]],
    },
    {
      row: 'unregistered qualified id',
      scope: 'docs.tree',
      command: 'docs.missing',
      options: undefined,
      className: '',
      anchored: [],
    },
    {
      row: 'no scope',
      scope: null,
      command: 'close',
      options: undefined,
      className: '',
      anchored: [['docs.close', {}]],
    },
  ])(
    'keyHint_AnchorsTheNamedCommandInScope: $row',
    ({ scope, command, options, className, anchored }) => {
      const { kit, anchors } = kitOver(scope);
      const parent = new FakeElement('div');

      const hint = asFake(kit.keyHint(asHtml(parent), command, options));

      expect(parent.childNodes).toEqual([hint]);
      expect(hint.tagName).toBe('SPAN');
      expect(hint.className).toBe(className);
      expect(hint.childNodes).toEqual([]);
      expect(anchors).toEqual(
        anchored.map(([id, anchorOptions]) => [hint, id, anchorOptions]),
      );
    },
  );

  it.each([
    { row: 'bound', scope: 'docs.tree', command: 'open', keys: 'Mod+O' },
    { row: 'bound, no scope', scope: null, command: 'open', keys: 'Mod+O' },
    {
      row: 'bound in another scope',
      scope: 'docs.view',
      command: 'open',
      keys: null,
    },
    { row: 'unbound', scope: 'docs.tree', command: 'close', keys: null },
    { row: 'unknown name', scope: 'docs.tree', command: 'nope', keys: null },
    {
      row: 'qualified id',
      scope: 'docs.tree',
      command: 'panes.focusLeft',
      keys: 'Alt+H',
    },
  ])('keys_ReadsInScope: $row', ({ scope, command, keys }) => {
    const { kit, reads } = kitOver(scope);

    expect(kit.keys(command)).toBe(keys);
    expect(kit.keysFor('docs.open')).toBe(
      scope === 'docs.view' ? null : 'Mod+O',
    );
    for (const [, readScope] of reads) {
      expect(readScope).toBe(scope ?? undefined);
    }
  });

  it.each([
    { scope: 'tree', anchoredIn: 'docs.tree' },
    { scope: { qualified: 'any' }, anchoredIn: 'any' },
  ] as const)(
    'ownerBaseKitDeps_KeyHint_NamesTheQualifiedCommandAndRecordsItsAnchor: $anchoredIn',
    ({ scope, anchoredIn }) => {
      const { keys, anchors } = recordingAnchors();
      const recorded: unknown[] = [];
      const manifest = {
        id: 'docs',
        commands: { open: { label: 'Open', group: 'Docs', runsIn: 'page' } },
      } as const;
      const kit = createBaseKit(
        ownerBaseKitDeps(
          manifest,
          {
            markdown: kitOver(null).deps.markdown,
            keys,
            commands: { exists: () => true, run: () => undefined },
            platform: 'macos',
          },
          scope,
          { recordAnchor: (anchor) => recorded.push(anchor) },
        ),
      );
      const parent = asHtml(new FakeElement('div'));

      kit.keyHint(parent, 'open');
      kit.keyHint(parent, 'nope');

      expect(
        anchors.map(({ command, scope, isDisposed }) => [
          command,
          scope,
          isDisposed,
        ]),
      ).toEqual([['docs.open', anchoredIn, false]]);
      expect(recorded).toHaveLength(1);
      (recorded[0] as { dispose(): void }).dispose();
      expect(anchors[0].isDisposed).toBe(true);
    },
  );

  it.each([
    { className: undefined, classes: ['codicon', 'codicon-book'] },
    {
      className: ' wide  bold ',
      classes: ['codicon', 'codicon-book', 'wide', 'bold'],
    },
  ])('icon_ClassName_AddsEachClass: $className', ({ className, classes }) => {
    const { kit } = kitOver(null);
    const parent = new FakeElement('div');

    const node = asFake(kit.icon(asHtml(parent), 'book', className));

    expect(parent.childNodes).toEqual([node]);
    expect(node.className.split(' ')).toEqual(classes);
  });

  it.each([
    {
      side: 'start',
      chevron: undefined,
      label: undefined,
      texts: ['‹', ''],
      hintAt: 1,
      anchored: { scope: 'docs.tree' },
    },
    {
      side: 'end',
      chevron: undefined,
      label: 'open',
      texts: ['', '›'],
      hintAt: 0,
      anchored: { scope: 'docs.tree', label: 'open' },
    },
    {
      side: 'start',
      chevron: '‹ Tree',
      label: undefined,
      texts: ['‹ Tree', ''],
      hintAt: 1,
      anchored: { scope: 'docs.tree' },
    },
  ] as const)(
    'edge_PlacesTheChevronAtItsSide: $side $chevron',
    ({ side, chevron, label, texts, hintAt, anchored }) => {
      const { kit, anchors } = kitOver('docs.tree');
      const parent = new FakeElement('div');

      const edge = asFake(
        kit.edge(asHtml(parent), 'open', { side, chevron, label }),
      );

      expect(parent.childNodes).toEqual([edge]);
      expect(edge.className).toBe('ui-key-edge');
      expect(edge.children.map((child) => child.textContent)).toEqual(texts);
      expect(anchors).toEqual([[edge.children[hintAt], 'docs.open', anchored]]);
    },
  );

  it('section_BlankText_DrawsNothing', () => {
    const { kit } = kitOver('docs.tree');
    const parent = new FakeElement('div');

    expect(kit.section(asHtml(parent), 'Context', ' \n ')).toBe(null);
    expect(parent.childNodes).toEqual([]);
    const section = asFake(
      kit.section(asHtml(parent), 'Context', 'why') as HTMLElement,
    );
    expect(parent.childNodes).toEqual([section]);
    expect(section.className).toBe('context');
  });
});
