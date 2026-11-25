import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAIN_AGENT_ID,
  type ChatEntry,
  type ChatImage,
} from '../../../contracts/agent';
import type { CommandId } from '../../../contracts/commands';
import {
  asFake,
  asHtml,
  FakeElement,
  findAll,
  installFakeDom,
} from '../../../shared/page/test-dom';
import type { ChatEntryPart, ChatEntryPartContext } from '../contract';
import { chatCommand } from '../ids';
import type { AnyEntryKind, EntryInput } from '../layouts/layout';
import { createEntryKit } from './chat-kit';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import { noLayoutState } from '../../../shared/page/layout-host/fake-layout-state.test-support';
import type { PermissionEntry } from './chat-state';

// An entry that is also its own input, as each fixture here is.
type KitEntry = ChatEntry & EntryInput<AnyEntryKind>;

const ASSISTANT: KitEntry = {
  kind: 'assistant',
  id: 'a1',
  at: 1000,
  agentId: MAIN_AGENT_ID,
  text: 'hi',
  streaming: false,
  raw: [],
};

const PERMISSION: PermissionEntry = {
  kind: 'permission',
  id: 'p1',
  at: 1000,
  toolName: 'Bash',
  input: {},
  summary: '',
  answer: null,
  raw: [],
};

const png: ChatImage = { mediaType: 'image/png', data: 'cG5n' };
const jpeg: ChatImage = { mediaType: 'image/jpeg', data: 'anBn' };
const gif: ChatImage = { mediaType: 'image/gif', data: 'Z2lm' };

describe('createEntryKit', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // `entry`'s kit, its input the entry itself, in session `s1`, drawing
  // `parts`; each anchor's dispose records its command in `disposed`, then
  // throws when the command is `throwsOn`; each thumbnail click records its
  // entry id and index in `opened`, each expander head click its entry id and
  // place in `expanderClicks`, and each log line goes to `logged`.
  function kitOf(
    entry: KitEntry = ASSISTANT,
    throwsOn?: CommandId,
    parts: readonly ChatEntryPart[] = [],
  ) {
    const disposed: CommandId[] = [];
    const opened: [string, number][] = [];
    const expanderClicks: [string, number][] = [];
    const logged: string[] = [];
    const entryKit = createEntryKit(entry, entry, {
      sessionId: 's1',
      entryParts: () => parts,
      log: (message) => logged.push(message),
      markdown: {
        block: (text) => text,
        inline: (text) => text,
        document: (text) => Promise.resolve(text),
        ...NO_FENCES,
      },
      keys: {
        anchor: (_node, command) => ({
          dispose: () => {
            disposed.push(command);
            if (command === throwsOn) {
              throw new Error('anchor refused');
            }
          },
        }),
        keysFor: () => null,
      },
      commands: {
        exists: () => true,
        argShape: () => undefined,
        run: () => undefined,
      },
      platform: 'macos',
      state: noLayoutState,
      allow: () => undefined,
      deny: () => undefined,
      openImages: (entryId, index) => opened.push([entryId, index]),
      expanderClicked: (entryId, place) =>
        expanderClicks.push([entryId, place]),
    });
    return { entryKit, disposed, opened, expanderClicks, logged };
  }

  // A part of `kinds` that records each build's context in `builds` and each
  // update's input in `updates`; its build throws `buildThrows` and its update
  // `updateThrows` when given.
  function recordingPart(
    id: string,
    kinds: readonly AnyEntryKind[],
    throws: { buildThrows?: string; updateThrows?: string } = {},
  ) {
    const builds: ChatEntryPartContext<AnyEntryKind>[] = [];
    const updates: EntryInput<AnyEntryKind>[] = [];
    const part: ChatEntryPart = {
      id,
      kinds,
      build(_parent, context) {
        if (throws.buildThrows !== undefined) {
          throw new Error(throws.buildThrows);
        }
        builds.push(context);
        return {
          update(input) {
            if (throws.updateThrows !== undefined) {
              throw new Error(throws.updateThrows);
            }
            updates.push(input);
          },
        };
      },
    };
    return { part, builds, updates };
  }

  // The `data-part` ids of the wrappers in `parent`'s holder, null for none.
  function wrapperIds(parent: FakeElement): string[] | null {
    const holders = findAll(parent, 'chat-entry-parts');
    if (holders.length === 0) {
      return null;
    }
    return findAll(holders[0], 'chat-entry-part').map(
      (wrapper) => asHtml(wrapper).dataset.part ?? '',
    );
  }

  const HARNESS: KitEntry = { kind: 'fake:card', id: 'h1', at: 1000, raw: [] };

  it.each([
    {
      case: 'a permission entry draws the parts of its kind',
      entry: PERMISSION,
      parts: [
        { id: 'a', kinds: ['permission'] },
        { id: 'b', kinds: ['tool'] },
        { id: 'c', kinds: ['permission', 'tool'] },
      ],
      wrappers: ['a', 'c'],
      logs: [],
    },
    {
      case: 'an assistant entry has no part of its kind',
      entry: ASSISTANT,
      parts: [
        { id: 'a', kinds: ['permission'] },
        { id: 'b', kinds: ['tool'] },
        { id: 'c', kinds: ['permission', 'tool'] },
      ],
      wrappers: null,
      logs: [],
    },
    {
      case: 'no parts added',
      entry: PERMISSION,
      parts: [],
      wrappers: null,
      logs: [],
    },
    {
      case: 'a build that throws',
      entry: PERMISSION,
      parts: [
        { id: 'a', kinds: ['permission'], buildThrows: 'boom' },
        { id: 'c', kinds: ['permission'] },
      ],
      wrappers: ['c'],
      logs: ['entry part a failed: boom'],
    },
    {
      case: 'a harness kind',
      entry: HARNESS,
      parts: [{ id: 'a', kinds: ['fake:card'] }],
      wrappers: ['a'],
      logs: [],
    },
  ] satisfies {
    case: string;
    entry: KitEntry;
    parts: {
      id: string;
      kinds: AnyEntryKind[];
      buildThrows?: string;
    }[];
    wrappers: string[] | null;
    logs: string[];
  }[])(
    'entryParts_PlacesPartsOfTheKindInAddOrder: $case',
    ({ entry, parts, wrappers, logs }) => {
      const { entryKit, logged } = kitOf(
        entry,
        undefined,
        parts.map(
          (each) =>
            recordingPart(each.id, each.kinds, {
              buildThrows: each.buildThrows,
            }).part,
        ),
      );
      const parent = new FakeElement('div');

      entryKit.kit.entryParts(asHtml(parent));

      expect(wrapperIds(parent)).toEqual(wrappers);
      expect(logged).toEqual(logs);
    },
  );

  it('entryParts_Build_GetsSessionIdAndInput', () => {
    const a = recordingPart('a', ['permission']);
    const { entryKit } = kitOf(PERMISSION, undefined, [a.part]);
    const parent = new FakeElement('div');

    entryKit.kit.entryParts(asHtml(parent));

    expect(a.builds).toEqual([{ sessionId: 's1', input: PERMISSION }]);
    expect(wrapperIds(parent)).toEqual(['a']);
  });

  it('entryParts_CalledTwice_Throws', () => {
    const { entryKit } = kitOf(PERMISSION);
    const parent = asHtml(new FakeElement('div'));
    entryKit.kit.entryParts(parent);

    expect(() => entryKit.kit.entryParts(parent)).toThrow(
      'permission entry placed entry parts twice',
    );
  });

  it('updateParts_RunsEachPartsUpdate_LogsAThrowOnce', () => {
    const a = recordingPart('a', ['permission'], { updateThrows: 'boom' });
    const b = recordingPart('b', ['permission']);
    const { entryKit, logged } = kitOf(PERMISSION, undefined, [a.part, b.part]);
    entryKit.kit.entryParts(asHtml(new FakeElement('div')));
    const next: PermissionEntry = {
      ...PERMISSION,
      answer: { allowed: true, reason: null },
    };

    entryKit.updateParts(next);
    entryKit.updateParts(next);

    expect(b.updates).toEqual([next, next]);
    expect(logged).toEqual(['entry part a update failed: boom']);
  });

  const body = () => asHtml(new FakeElement('div'));

  it.each([
    { case: 'every anchor disposes', throwsOn: undefined },
    { case: "the base kit's anchor throws", throwsOn: chatCommand('send') },
  ])(
    'dispose disposes the base kit and permission anchors when $case',
    ({ throwsOn }) => {
      const { entryKit, disposed } = kitOf(PERMISSION, throwsOn);
      entryKit.kit.keyHint(asHtml(new FakeElement('div')), 'send');
      entryKit.kit.permissionActions(asHtml(new FakeElement('div')));

      const dispose = () => entryKit.dispose();

      if (throwsOn === undefined) {
        dispose();
      } else {
        expect(dispose).toThrow('anchor refused');
      }
      expect(disposed).toEqual([
        chatCommand('send'),
        chatCommand('allowOrCopy'),
        chatCommand('denyPermission'),
      ]);
    },
  );

  it('collapsibleRow_RegistersWithExpanders', () => {
    const { entryKit } = kitOf();
    const parent = asHtml(new FakeElement('div'));
    const first = entryKit.kit.collapsibleRow(parent, {
      summary: 'Thinking',
      body,
    });
    const second = entryKit.kit.collapsibleRow(parent, {
      summary: 'Tool',
      body,
    });

    const toggled = entryKit.expanders.toggle(1);
    const noPlace = entryKit.expanders.toggle(2);

    expect(entryKit.expanders.count()).toBe(2);
    expect([toggled, noPlace]).toEqual(['expanded', 'nothing']);
    expect([first.isOpen(), second.isOpen()]).toEqual([false, true]);
    expect(entryKit.expanders.toggle(1)).toBe('collapsed');

    entryKit.expanders.setAllOpen(true);

    expect([first.isOpen(), second.isOpen()]).toEqual([true, true]);
  });

  it('collapsibleRow_HeadClick_RunsExpanderClickedAndOpensNothing', () => {
    const { entryKit, expanderClicks } = kitOf();
    const parent = asHtml(new FakeElement('div'));
    entryKit.kit.collapsibleRow(parent, { summary: 'Thinking', body });
    const second = entryKit.kit.collapsibleRow(parent, {
      summary: 'Tool',
      body,
    });

    findAll(asFake(second.element), 'ui-collapsible-head')[0].click();

    expect(expanderClicks).toEqual([['a1', 1]]);
    expect(second.isOpen()).toBe(false);
  });

  it('images_ThumbnailClick_PassesEntryIdAndIndex', () => {
    const { entryKit, opened } = kitOf({
      kind: 'user',
      id: 'u1',
      at: 1000,
      from: null,
      text: 'look',
      images: [png, jpeg, gif],
      delivery: null,
      isLatestDelivery: false,
      raw: [],
    });
    const strip = entryKit.kit.images(asHtml(new FakeElement('div')));

    findAll(asFake(strip), 'chat-image-thumbnail')[1].click();

    expect(opened).toEqual([['u1', 1]]);
  });
});
