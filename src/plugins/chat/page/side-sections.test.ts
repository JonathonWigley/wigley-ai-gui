import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UiState } from '../../../contracts/ui-state';
import { createPartStore } from '../../../shared/page/contributed-parts';
import {
  recordingAnchors,
  withUser,
} from '../../../shared/page/layout-host/test-layouts';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import {
  asHtml,
  FakeElement,
  findAll,
  installFakeDom,
} from '../../../shared/page/test-dom';
import type { ChatSidePart, ChatSideSection } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { ChatLayout } from '../layouts/layout';
import { createChatLayouts } from './chat-layouts';
import { createSideSections, type SideTab } from './side-sections';
import { noLayoutState } from '../../../shared/page/layout-host/fake-layout-state.test-support';

const COLLAPSED = 'collapsed-sections';
const HIDDEN = 'hub-hidden';
const WIDTH = 'hub-width';

function fakeUiState(initial: Record<string, unknown> = {}): UiState {
  const held = new Map(Object.entries(initial));
  return {
    get: (key) => held.get(key),
    set: (key, value) => {
      held.set(key, value);
    },
  };
}

// Side sections over a real part store and the default layout. `openTab` opens
// a built tab on a fresh root; `recordingPart` is a part counting its builds and
// disposes and keeping each build's section.
function setUp(uiState = fakeUiState()) {
  const logs: string[] = [];
  const log = (line: string) => logs.push(line);
  const layouts = createChatLayouts(log);
  const parts = createPartStore<ChatSidePart>();
  const sections = createSideSections({
    layouts,
    kit: {
      markdown: {
        block: (text: string) => text,
        inline: (text: string) => text,
        document: (text: string) => Promise.resolve(text),
        ...NO_FENCES,
      },
      keys: recordingAnchors().keys,
      commands: {
        exists: () => true,
        argShape: () => undefined,
        run: () => undefined,
      },
      platform: 'macos',
      state: noLayoutState,
      log,
    },
    parts,
    uiState,
    timers: { set: () => 0, clear: () => undefined },
    // As the head's command does in the app.
    toggleClicked: (partId) => sections.toggleSection(partId),
    log,
  });
  const tabs: { root: FakeElement; side: SideTab }[] = [];
  const openTab = (sessionId = `s${tabs.length}`) => {
    const root = new FakeElement('div');
    const side = sections.openTab(asHtml(root), sessionId);
    side.sync();
    const tab = { root, side };
    tabs.push(tab);
    return tab;
  };
  return { logs, layouts, parts, sections, uiState, openTab };
}

function recordingPart(id: string, order = 10) {
  const record = {
    builds: 0,
    disposes: 0,
    sections: [] as ChatSideSection[],
    part: {
      id,
      title: `Title ${id}`,
      order,
      build(parent, _sessionId, section) {
        record.builds += 1;
        record.sections.push(section);
        parent.textContent = `content ${id}`;
        return {
          dispose: () => {
            record.disposes += 1;
          },
        };
      },
    } satisfies ChatSidePart,
  };
  return record;
}

function sectionOrder(root: FakeElement): string[] {
  return findAll(root, 'chat-side-part').map((wrapper) => wrapper.dataset.part);
}

function frameOf(root: FakeElement) {
  return findAll(root, 'chat-side-section')[0];
}

function headOf(root: FakeElement) {
  return findAll(root, 'chat-side-section-head')[0];
}

function summaryOf(root: FakeElement) {
  return findAll(root, 'chat-side-section-summary')[0].textContent;
}

function holderOf(root: FakeElement) {
  return findAll(root, 'chat-side-parts')[0];
}

// A primary press on `root`'s hub handle at `from`, a move to `to` and the
// release, `root` drawn 1000 px wide with its left edge at the client's origin.
function dragHandle(root: FakeElement, from: number, to: number) {
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 1000,
    height: 500,
  });
  const handle = findAll(root, 'chat-side-handle')[0];
  const captured = new Set<number>();
  Object.assign(handle, {
    setPointerCapture: (id: number) => captured.add(id),
    hasPointerCapture: (id: number) => captured.has(id),
  });
  handle.fire('pointerdown', { button: 0, pointerId: 1, clientX: from });
  handle.fire('pointermove', { pointerId: 1, clientX: to });
  (window as unknown as FakeElement).fire('pointerup', { pointerId: 1 });
}

describe('createSideSections', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a tab sits its sections in order, equal orders in add order', () => {
    const { parts, openTab } = setUp();
    parts.add(recordingPart('thirty', 30).part);
    parts.add(recordingPart('ten', 10).part);
    parts.add(recordingPart('twenty', 20).part);
    parts.add(recordingPart('twenty-later', 20).part);

    const { root } = openTab();

    expect(sectionOrder(root)).toEqual([
      'ten',
      'twenty',
      'twenty-later',
      'thirty',
    ]);
  });

  it.each([
    { order: 5, expected: ['added', 'ten', 'thirty'] },
    { order: 20, expected: ['ten', 'added', 'thirty'] },
    { order: 10, expected: ['ten', 'added', 'thirty'] },
    { order: 40, expected: ['ten', 'thirty', 'added'] },
  ])(
    'a part added to a built tab at order $order goes to its sorted place and moves no built wrapper',
    ({ order, expected }) => {
      const { parts, openTab } = setUp();
      const ten = recordingPart('ten', 10);
      const thirty = recordingPart('thirty', 30);
      parts.add(ten.part);
      parts.add(thirty.part);
      const { root, side } = openTab();
      const holder = root.children[0];
      const insertBefore = vi.spyOn(holder, 'insertBefore');

      parts.add(recordingPart('added', order).part);
      side.sync();

      expect(sectionOrder(root)).toEqual(expected);
      for (const [wrapper] of insertBefore.mock.calls) {
        expect(wrapper.dataset.part).toBe('added');
      }
      expect({ ten: ten.builds, thirty: thirty.builds }).toEqual({
        ten: 1,
        thirty: 1,
      });
    },
  );

  it("a head's click collapses the section in both tabs, keeps its id and rebuilds no part", () => {
    const { parts, uiState, openTab, logs } = setUp(
      fakeUiState({ [COLLAPSED]: ['nobody-registers-this'] }),
    );
    const part = recordingPart('part');
    parts.add(part.part);
    const first = openTab();
    const second = openTab();
    const frameBefore = frameOf(first.root);

    headOf(first.root).click();

    for (const { root } of [first, second]) {
      expect(frameOf(root).classList.contains('is-collapsed')).toBe(true);
      expect(findAll(root, 'codicon-chevron-right')).toHaveLength(1);
      expect(findAll(root, 'codicon-chevron-down')).toHaveLength(0);
    }
    expect(frameOf(first.root)).toBe(frameBefore);
    expect(uiState.get(COLLAPSED)).toEqual(['nobody-registers-this', 'part']);
    expect(part.builds).toBe(2);
    expect(logs).toContain('section Title part collapsed');

    headOf(second.root).click();

    for (const { root } of [first, second]) {
      expect(frameOf(root).classList.contains('is-collapsed')).toBe(false);
    }
    expect(uiState.get(COLLAPSED)).toEqual(['nobody-registers-this']);
    expect(logs).toContain('section Title part expanded');
  });

  it('toggleSection_PartNoSectionHolds_LogsAndKeepsCollapsedSections', () => {
    const { parts, uiState, sections, openTab, logs } = setUp(
      fakeUiState({ [COLLAPSED]: ['other'] }),
    );
    parts.add(recordingPart('part').part);
    const { root } = openTab();

    sections.toggleSection('gone');

    expect(logs).toContain('no section gone');
    expect(uiState.get(COLLAPSED)).toEqual(['other']);
    expect(frameOf(root).classList.contains('is-collapsed')).toBe(false);
  });

  it('a head keeps the focus where it was and takes no key', () => {
    const { parts, openTab } = setUp();
    parts.add(recordingPart('part').part);

    const head = headOf(openTab().root);

    expect(head.tabIndex).toBe(-1);
    expect(head.fire('mousedown').defaultPrevented).toBe(true);
  });

  it.each([
    { held: ['part'], collapsed: true },
    { held: ['other'], collapsed: false },
    { held: 'part', collapsed: false },
    { held: { part: true }, collapsed: false },
  ])(
    'a tab reading collapsed-sections as $held starts collapsed: $collapsed',
    ({ held, collapsed }) => {
      const { parts, openTab } = setUp(fakeUiState({ [COLLAPSED]: held }));
      parts.add(recordingPart('part').part);

      const { root } = openTab();

      expect(frameOf(root).classList.contains('is-collapsed')).toBe(collapsed);
    },
  );

  it("setSummary changes that tab's frame only, and null empties it", () => {
    const { parts, openTab } = setUp();
    const part = recordingPart('part');
    parts.add(part.part);
    const first = openTab();
    const second = openTab();

    part.sections[0].setSummary('5/7');

    expect(summaryOf(first.root)).toBe('5/7');
    expect(summaryOf(second.root)).toBe('');

    part.sections[0].setSummary(null);

    expect(summaryOf(first.root)).toBe('');
  });

  it('toggleHidden marks every tab, keeps the choice, and a later tab reads it', () => {
    const { sections, uiState, openTab, logs } = setUp();
    const { root } = openTab();

    sections.toggleHidden();

    expect(root.classList.contains('is-side-hidden')).toBe(true);
    expect(uiState.get(HIDDEN)).toBe(true);
    expect(logs).toContain('session hub hidden');
    expect(openTab().root.classList.contains('is-side-hidden')).toBe(true);

    sections.toggleHidden();

    expect(root.classList.contains('is-side-hidden')).toBe(false);
    expect(uiState.get(HIDDEN)).toBe(false);
    expect(logs).toContain('session hub shown');
  });

  it('hub-hidden true at the start hides the first tab', () => {
    const { openTab } = setUp(fakeUiState({ [HIDDEN]: true }));

    expect(openTab().root.classList.contains('is-side-hidden')).toBe(true);
  });

  it('a drag on one hub handle widens every tab, keeps the width, and a later tab reads it', () => {
    const { uiState, openTab, logs } = setUp();
    const first = openTab();
    const second = openTab();

    dragHandle(first.root, 736, 636);

    for (const { root } of [first, second]) {
      expect(holderOf(root).style['--chat-side-width']).toBe('364');
    }
    expect(uiState.get(WIDTH)).toBe(364);
    expect(logs).toContain('session hub width 364');
    expect(holderOf(openTab().root).style['--chat-side-width']).toBe('364');
  });

  it.each([
    { to: 950, width: '200' },
    { to: 10, width: '680' },
  ])(
    'a drag to $to stops at width $width, leaving the hub and the entries their least widths',
    ({ to, width }) => {
      const { openTab } = setUp();
      const { root } = openTab();

      dragHandle(root, 736, to);

      expect(holderOf(root).style['--chat-side-width']).toBe(width);
    },
  );

  it('a part added to a tab sits before the hub handle', () => {
    const { parts, openTab } = setUp();
    parts.add(recordingPart('first').part);
    const { root, side } = openTab();

    parts.add(recordingPart('second').part);
    side.sync();

    const classes = holderOf(root).children.map((child) => child.className);
    expect(classes.at(-1)).toContain('chat-side-handle');
    expect(sectionOrder(root)).toEqual(['first', 'second']);
  });

  it.each([
    {
      name: 'has no update',
      update: undefined,
    },
    {
      name: 'has an update that throws',
      update: () => {
        throw new Error('update failed');
      },
    },
  ])(
    'a frame that $name draws again on a collapse with the same body and no rebuild',
    ({ update }) => {
      const { parts, layouts, openTab } = setUp();
      const part = recordingPart('part');
      parts.add(part.part);
      const user: ChatLayout = {
        sideSection(parent, input, kit) {
          const section = document.createElement('section');
          section.className = 'chat-side-section';
          section.classList.toggle('is-collapsed', input.collapsed);
          parent.append(section);
          kit.head(section);
          kit.body(section);
          return { element: section, update };
        },
      };
      layouts.set(withUser<ChatLayout>(defaultLayout, user));
      const { root } = openTab();
      const body = findAll(root, 'chat-side-section-body')[0];

      headOf(root).click();

      expect(findAll(root, 'chat-side-section')).toHaveLength(1);
      expect(frameOf(root).classList.contains('is-collapsed')).toBe(true);
      expect(findAll(root, 'chat-side-section-body')).toEqual([body]);
      expect(body.textContent).toBe('content part');
      expect(part.builds).toBe(1);
    },
  );

  it('a layout that leaves out kit.body gets the body at the end of its element', () => {
    const { parts, layouts, openTab } = setUp();
    parts.add(recordingPart('part').part);
    const user: ChatLayout = {
      sideSection(parent) {
        const section = document.createElement('section');
        parent.append(section);
        return { element: section };
      },
    };
    layouts.set(withUser<ChatLayout>(defaultLayout, user));

    const { root } = openTab();

    const [wrapper] = findAll(root, 'chat-side-part');
    const section = wrapper.children[0];
    expect(section.lastElementChild?.className).toBe('chat-side-section-body');
    expect(section.textContent).toBe('content part');
  });

  it('a frame that fails in the default layout too leaves the content in a bare body', () => {
    vi.spyOn(defaultLayout, 'sideSection').mockImplementation(() => {
      throw new Error('frame failed');
    });
    const { parts, openTab, logs } = setUp();
    const part = recordingPart('part');
    parts.add(part.part);

    const { root } = openTab();

    const [wrapper] = findAll(root, 'chat-side-part');
    expect(wrapper.children.map((child) => child.className)).toEqual([
      'chat-side-section-body',
    ]);
    expect(wrapper.textContent).toBe('content part');
    expect(logs.join('\n')).toContain('frame failed');
    expect(() => part.sections[0].setSummary('5/7')).not.toThrow();
    expect(wrapper.textContent).toBe('content part');
  });

  it("setSummary after the build's dispose changes nothing and does not throw", () => {
    const { parts, openTab } = setUp();
    const part = recordingPart('part');
    const added = parts.add(part.part);
    const { root, side } = openTab();
    const frame = frameOf(root);
    part.sections[0].setSummary('kept');

    added.dispose();
    side.sync();

    expect(part.disposes).toBe(1);
    expect(() => part.sections[0].setSummary('late')).not.toThrow();
    expect(frame.textContent).not.toContain('late');
    expect(sectionOrder(root)).toEqual([]);
  });

  it("a part's build that throws leaves no wrapper and closes its frame", () => {
    const { parts, openTab, logs } = setUp();
    parts.add({
      id: 'failing',
      title: 'Failing',
      order: 10,
      build() {
        throw new Error('build failed');
      },
    });

    const { root } = openTab();

    expect(sectionOrder(root)).toEqual([]);
    expect(logs.join('\n')).toContain('build failed');
  });

  it('rebuild disposes each build once and builds it again; close stops the toggles reaching the tab', () => {
    const { parts, sections, openTab } = setUp();
    const part = recordingPart('part');
    parts.add(part.part);
    const { root, side } = openTab();

    side.rebuild();

    expect({ builds: part.builds, disposes: part.disposes }).toEqual({
      builds: 2,
      disposes: 1,
    });
    expect(sectionOrder(root)).toEqual(['part']);

    side.close();
    sections.toggleHidden();

    expect(part.disposes).toBe(2);
    expect(root.classList.contains('is-side-hidden')).toBe(false);
  });
});
