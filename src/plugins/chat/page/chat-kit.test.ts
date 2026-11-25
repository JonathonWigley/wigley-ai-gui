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
import { chatCommand } from '../ids';
import { createEntryKit } from './chat-kit';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import { noLayoutState } from '../../../shared/page/layout-host/fake-layout-state.test-support';

const ASSISTANT: ChatEntry = {
  kind: 'assistant',
  id: 'a1',
  at: 1000,
  agentId: MAIN_AGENT_ID,
  text: 'hi',
  streaming: false,
  raw: [],
};

const PERMISSION: ChatEntry = {
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

  // `entry`'s kit; each anchor's dispose records its command in `disposed`,
  // then throws when the command is `throwsOn`; each thumbnail click records
  // its entry id and index in `opened`, and each expander head click its entry
  // id and place in `expanderClicks`.
  function kitOf(entry: ChatEntry = ASSISTANT, throwsOn?: CommandId) {
    const disposed: CommandId[] = [];
    const opened: [string, number][] = [];
    const expanderClicks: [string, number][] = [];
    const entryKit = createEntryKit(entry, {
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
    return { entryKit, disposed, opened, expanderClicks };
  }

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
      text: 'look',
      images: [png, jpeg, gif],
      delivery: null,
      raw: [],
    });
    const strip = entryKit.kit.images(asHtml(new FakeElement('div')));

    findAll(asFake(strip), 'chat-image-thumbnail')[1].click();

    expect(opened).toEqual([['u1', 1]]);
  });
});
