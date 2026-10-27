import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewScope } from '../../../contracts/keymap';
import { asFake, asHtml, FakeElement, installFakeDom } from '../test-dom';
import {
  type BaseKitDeps,
  commandRunner,
  createBaseKit,
  type KitCommands,
} from './base-kit';

const BOUND: Record<string, string> = { 'docs.open': 'Mod+O' };

// A kit for owner `docs` whose only commands are `open` and `close`, with
// `Mod+O` bound to `docs.open` in `docs.tree` alone, recording each anchor
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
    commands: { exists: () => true, run: () => undefined },
    scope,
    commandNamed: (short) =>
      short === 'open' || short === 'close' ? `docs.${short}` : null,
    platform: 'macos',
  };
  return { kit: createBaseKit(deps), anchors, reads };
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
