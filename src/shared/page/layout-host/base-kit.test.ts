import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandArg } from '../../../contracts/commands';
import {
  coreRuntimeMainSlot,
  coreRuntimePageSlot,
} from '../../../contracts/core-state';
import type { Disposable } from '../../../contracts/disposable';
import type { ViewScope } from '../../../contracts/keymap';
import type {
  CommandInfo,
  PageCommandContext,
  PluginCommands,
} from '../../../contracts/plugin';
import type { KeyedSlotKey, SlotKey } from '../../../contracts/state';
import { commandTarget } from '../../command-args';
import { CommandRegistry } from '../../command-registry';
import { createRuntimeCommands } from '../../runtime-commands';
import { createSlotStore, layoutState } from '../../state/slot-store';
import { asFake, asHtml, FakeElement, installFakeDom } from '../test-dom';
import {
  type BaseKitDeps,
  commandRunner,
  createBaseKit,
  type KitCommands,
  keyRunner,
  kitCommandsOf,
  ownerBaseKitDeps,
} from './base-kit';
import { noLayoutState } from './fake-layout-state.test-support';
import { recordingAnchors } from './test-layouts';
import type { MarkdownMount } from '../markdown-mount';
import {
  fencePlaceholder,
  installMarkdownDom,
  NO_FENCES,
} from '../markdown-mount.test-support';

const valueSlot: SlotKey<number, 'page', 'p'> = {
  id: 'p.v',
  process: 'page',
  kind: 'value',
};
const keyedSlot: KeyedSlotKey<number, 'page', 'p'> = {
  id: 'p.k',
  process: 'page',
  kind: 'keyed',
};

const BOUND: Record<string, string> = {
  'docs.open': 'Mod+O',
  'panes.focusLeft': 'Alt+H',
  'docs.pick 2': 'Mod+2',
};

// A kit for owner `docs` whose only commands are `open`, `close` and `pick`,
// with `Mod+O` bound to `docs.open`, `Alt+H` to `panes.focusLeft` and `Mod+2` to
// `docs.pick` with the argument 2 in `docs.tree` alone, recording each anchor
// and each keys read.
function kitOver(scope: ViewScope | null) {
  const anchors: unknown[][] = [];
  const reads: unknown[][] = [];
  const deps: BaseKitDeps = {
    markdown: {
      block: (text) => `<p>${text}</p>`,
      inline: (text) => text,
      document: async (text) => text,
      ...NO_FENCES,
    },
    keys: {
      anchor(element, command, options) {
        anchors.push([asFake(element), command, options]);
        return { dispose: () => undefined };
      },
      keysFor(command, readScope, _where, arg) {
        reads.push([command, readScope]);
        return readScope === 'docs.tree' || readScope === undefined
          ? (BOUND[commandTarget(command, arg)] ?? null)
          : null;
      },
    },
    commands: {
      exists: (id) =>
        ['docs.open', 'docs.close', 'docs.pick', 'panes.focusLeft'].includes(
          id,
        ),
      argShape: () => undefined,
      run: () => undefined,
    },
    scope,
    commandNamed: (short) =>
      ['open', 'close', 'pick'].includes(short) ? `docs.${short}` : null,
    platform: 'macos',
    state: noLayoutState,
    recordAnchor: () => undefined,
  };
  return { kit: createBaseKit(deps), deps, anchors, reads };
}

// Commands `docs.open`, with no arg, and `docs.pick`, which takes a number,
// recording each run as its id and arg.
function recordingCommands() {
  const ran: unknown[][] = [];
  const commands: KitCommands = {
    exists: (id) => id === 'docs.open' || id === 'docs.pick',
    argShape: (id) => (id === 'docs.pick' ? 'number' : undefined),
    run: (id, arg) => {
      ran.push([id, arg]);
    },
  };
  return { commands, ran };
}

describe('createBaseKit', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { ms: 0, text: '0s' },
    { ms: 8000, text: '8s' },
    { ms: 42999, text: '42s' },
    { ms: 59999, text: '59s' },
    { ms: 60000, text: '1m 00s' },
    { ms: 185000, text: '3m 05s' },
    { ms: 3599000, text: '59m 59s' },
    { ms: 3600000, text: '1h 00m' },
    { ms: 3720000, text: '1h 02m' },
    { ms: -500, text: '0s' },
  ])('duration_Ms_Formats ($ms → $text)', ({ ms, text }) => {
    expect(kitOver(null).kit.duration(ms)).toBe(text);
  });

  it.each<{ row: string; id: string; arg?: CommandArg; throws: string }>([
    { row: 'an unknown id', id: 'docs.nope', throws: 'no command docs.nope' },
    {
      row: 'a missing declared arg',
      id: 'docs.pick',
      throws: 'command "docs.pick" needs a number',
    },
    {
      row: 'a bad arg',
      id: 'docs.pick',
      arg: 'two',
      throws: 'command "docs.pick" needs a number',
    },
    {
      row: 'an arg on a command with none',
      id: 'docs.open',
      arg: 2,
      throws: 'command "docs.open" takes no argument',
    },
  ])(
    'commandRunner_UnknownIdOrArgNeeded_ThrowsAtCreationAndRunsOnlyOnCall: $row',
    ({ id, arg, throws }) => {
      const { commands } = recordingCommands();

      expect(() => commandRunner(id, commands, arg)).toThrow(throws);
    },
  );

  it.each<{ id: string; arg?: CommandArg }>([
    { id: 'docs.open' },
    { id: 'docs.pick', arg: 3 },
  ])('commandRunner_Valid_RunsOnlyOnEachCall: $id', ({ id, arg }) => {
    const { commands, ran } = recordingCommands();

    const run = commandRunner(id, commands, arg);
    expect(ran).toEqual([]);
    run();
    run();

    expect(ran).toEqual([
      [id, arg],
      [id, arg],
    ]);
  });

  it('button_Click_RunsCommandWithItsArg', () => {
    const { commands, ran } = recordingCommands();
    const kit = createBaseKit({ ...kitOver(null).deps, commands });
    const parent = new FakeElement('div');

    const button = asFake(
      kit.button(asHtml(parent), 'Pick', 'docs.pick', { arg: 2 }),
    );
    expect(ran).toEqual([]);
    button.click();

    expect(ran).toEqual([['docs.pick', 2]]);
  });

  it.each<{ row: string; arg?: CommandArg; runs: unknown[][] }>([
    { row: 'no arg', runs: [['docs.open']] },
    { row: 'an arg', arg: 2, runs: [[{ id: 'docs.open' }, 2]] },
  ])('kitCommandsOf_ArgGiven_RunsThroughCommandKey: $row', ({ arg, runs }) => {
    const calls: unknown[][] = [];
    const commands = kitCommandsOf({
      keys: { command: () => undefined },
      commands: {
        run: (...args: unknown[]) => {
          calls.push(args);
          return Promise.resolve();
        },
      } as Pick<PluginCommands, 'run'>,
      services: { log: () => undefined },
    });

    commands.run('docs.open', arg);

    expect(calls).toEqual(runs);
  });

  it('kitCommandsOf_ServedCommandWithNoHandler_LogsAndRunsNothing', () => {
    const served: Record<string, CommandInfo> = {
      'docs.open': {
        id: 'docs.open',
        plugin: 'docs',
        label: 'Open',
        group: 'docs',
        runsIn: 'page',
      },
    };
    const store = createSlotStore(() => undefined);
    const runtime = createRuntimeCommands<PageCommandContext<any>>({
      process: 'page',
      registry: new CommandRegistry(() => undefined),
      writer: store.publish(coreRuntimePageSlot),
      other: store.read(coreRuntimeMainSlot, 'core'),
      served: () => served,
      leader: () => ' ',
      remote: () => Promise.resolve(),
    });
    const logged: string[] = [];
    const commands = kitCommandsOf({
      keys: { command: (id) => runtime.infoOf(id) },
      commands: runtime.forPlugin('docs', (handle) => handle).commands,
      services: { log: (message) => logged.push(message) },
    });

    const run = commandRunner('docs.open', commands);
    expect(() => run()).not.toThrow();

    expect(logged).toEqual([
      'command docs.open failed: No command is registered as "docs.open"',
    ]);
  });

  it('keyRunner_RunThrows_LogsAndDoesNotThrow', () => {
    const logged: string[] = [];
    const run = keyRunner(
      {
        run: () => {
          throw new Error('stale arg');
        },
      },
      (message) => logged.push(message),
    );

    expect(() => run({ id: 'docs.pick' }, 2)).not.toThrow();

    expect(logged).toEqual(['command docs.pick failed: stale arg']);
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
      row: 'qualified id no plugin registers yet',
      scope: 'docs.tree',
      command: 'docs.missing',
      options: undefined,
      className: '',
      anchored: [['docs.missing', { scope: 'docs.tree' }]],
    },
    {
      row: 'an arg',
      scope: 'docs.tree',
      command: 'pick',
      options: { arg: 2 },
      className: '',
      anchored: [['docs.pick', { scope: 'docs.tree', arg: 2 }]],
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
      row: 'unregistered qualified id',
      scope: 'docs.tree',
      command: 'docs.missing',
      keys: null,
    },
    {
      row: 'qualified id',
      scope: 'docs.tree',
      command: 'panes.focusLeft',
      keys: 'Alt+H',
    },
    {
      row: "an arg's bind",
      scope: 'docs.tree',
      command: 'pick',
      arg: 2,
      keys: 'Mod+2',
    },
    {
      row: 'an arg no bind carries',
      scope: 'docs.tree',
      command: 'pick',
      arg: 3,
      keys: null,
    },
  ])('keys_ReadsInScope: $row', ({ scope, command, arg, keys }) => {
    const { kit, reads } = kitOver(scope);

    expect(kit.keys(command, arg)).toBe(keys);
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
            commands: {
              exists: () => true,
              argShape: () => undefined,
              run: () => undefined,
            },
            platform: 'macos',
            state: noLayoutState,
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

  it('stateRead_On_RecordsTheSubscription', () => {
    const store = createSlotStore(() => undefined);
    const writer = store.publish(valueSlot);
    const recorded: Disposable[] = [];
    const heard: unknown[][] = [];
    const kit = createBaseKit({
      ...kitOver(null).deps,
      state: layoutState(store, 'docs', (handle) => handle),
      recordAnchor: (anchor) => recorded.push(anchor),
    });

    kit.state.read('p.v').on((...args) => heard.push(args));
    writer.set(1);
    expect(recorded).toHaveLength(1);
    recorded[0].dispose();
    writer.set(2);

    expect(heard).toEqual([[1]]);
  });

  it.each([
    {
      row: 'no key',
      id: 'p.k',
      key: undefined,
      value: [
        ['a', 1],
        ['b', 2],
      ],
    },
    { row: 'a key', id: 'p.k', key: 'b', value: 2 },
    { row: 'no slot, no key', id: 'p.none', key: undefined, value: undefined },
    { row: 'no slot, a key', id: 'p.none', key: 'b', value: undefined },
  ])('stateRead_Get_ReadsThroughDeps: $row', ({ id, key, value }) => {
    const store = createSlotStore(() => undefined);
    const writer = store.publish(keyedSlot);
    writer.set('a', 1);
    writer.set('b', 2);
    const kit = createBaseKit({
      ...kitOver(null).deps,
      state: layoutState(store, 'docs', (handle) => handle),
    });

    expect(kit.state.read(id).get(key)).toEqual(value);
  });

  it('meter_AppendsAMeterFilledToItsPercentInItsTone', () => {
    const { kit } = kitOver(null);
    const parent = new FakeElement('div');

    const node = asFake(kit.meter(asHtml(parent), 42, 'warning'));

    expect(parent.childNodes).toEqual([node]);
    expect(node.className).toBe('ui-meter');
    expect(node.dataset.tone).toBe('warning');
    expect(node.attributes.get('aria-valuenow')).toBe('42');
  });

  it('sparkline_AppendsALineInItsTone', () => {
    const { kit } = kitOver(null);
    const parent = new FakeElement('div');

    const node = asFake(
      kit.sparkline(asHtml(parent), [10, 55, 100], 'critical'),
    );

    expect(parent.childNodes).toEqual([node]);
    expect(node.className).toBe('ui-sparkline');
    expect(node.dataset.tone).toBe('critical');
    expect(node.attributes.get('aria-hidden')).toBe('true');
    const [svg] = node.children;
    expect(node.children).toEqual([svg]);
    expect(svg.attributes.get('class')).toBe('ui-sparkline-svg');
    expect(svg.attributes.get('viewBox')).toBe('0 0 2 100');
    const [line] = svg.children;
    expect(svg.children).toEqual([line]);
    expect(line.attributes.get('class')).toBe('ui-sparkline-line');
    expect(line.attributes.get('points')).toBe('0,90 1,45 2,0');
  });

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

  it('draws markdown through one recorded mount', () => {
    installMarkdownDom((name, value) => vi.stubGlobal(name, value));
    const fence = liveFence();
    const recorded: MarkdownMount[] = [];
    const kitWith = (recordMount?: (mount: MarkdownMount) => void) =>
      createBaseKit({
        ...kitOver(null).deps,
        markdown: fence.markdown,
        recordMount,
      });
    const kit = kitWith((mount) => recorded.push(mount));
    const parent = asHtml(new FakeElement('div'));

    kit.markdown(parent, 'a');
    parent.replaceChildren();
    kit.markdown(parent, 'a');

    expect(fence.mounts).toBe(1);
    expect(recorded).toHaveLength(1);
    recorded[0].dispose();
    expect(fence.disposals).toBe(1);
    kitWith().markdown(parent, 'a', '', { liveFences: false });
    expect(fence.mounts).toBe(1);
  });

  it('disposes the mount through the rollback ownerBaseKitDeps takes', () => {
    installMarkdownDom((name, value) => vi.stubGlobal(name, value));
    const fence = liveFence();
    const recorded: { dispose(): void }[] = [];
    const kit = createBaseKit(
      ownerBaseKitDeps(
        { id: 'docs', commands: {} },
        {
          markdown: fence.markdown,
          keys: kitOver(null).deps.keys,
          commands: {
            exists: () => true,
            argShape: () => undefined,
            run: () => undefined,
          },
          platform: 'macos',
          state: noLayoutState,
        },
        null,
        { recordAnchor: (anchor) => recorded.push(anchor) },
      ),
    );

    kit.markdown(asHtml(new FakeElement('div')), 'a');
    for (const anchor of recorded) {
      anchor.dispose();
    }

    expect(fence.disposals).toBe(1);
  });
});

// A renderer whose `block` returns one closed `html` placeholder, its live
// contribution counting mounts and view disposals.
function liveFence() {
  const counts = { mounts: 0, disposals: 0 };
  const contribution = {
    language: 'html',
    live: true,
    mount: () => {
      counts.mounts += 1;
      return {
        element: document.createElement('div'),
        dispose: () => {
          counts.disposals += 1;
        },
      };
    },
  };
  return {
    get mounts() {
      return counts.mounts;
    },
    get disposals() {
      return counts.disposals;
    },
    markdown: {
      block: () => fencePlaceholder('html', true, 'x'),
      inline: (text: string) => text,
      document: async (text: string) => text,
      addFence: () => ({ dispose: () => undefined }),
      fence: (language: string) =>
        language === 'html' ? contribution : undefined,
    },
  };
}
