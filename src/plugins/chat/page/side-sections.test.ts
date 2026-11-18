import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Disposable } from '../../../contracts/disposable';
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
  type FocusFakeDocument,
  type FocusFakeElement,
  installFakeDom,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import type { ChatSidePart, ChatSideSection } from '../contract';
import defaultLayout from '../layouts/default/layout.js';
import type { ChatLayout } from '../layouts/layout';
import { createChatLayouts } from './chat-layouts';
import {
  createSideSections,
  type SectionCursor,
  type SideSections,
  type SideTab,
} from './side-sections';
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

function recordingPart(
  id: string,
  order = 10,
  options: Pick<ChatSidePart, 'shrinksLast'> = {},
) {
  const record = {
    builds: 0,
    disposes: 0,
    sections: [] as ChatSideSection[],
    part: {
      id,
      title: `Title ${id}`,
      order,
      ...options,
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

  it('a tab sits its sections in order, equal orders in add order, and marks only the shrinksLast wrapper', () => {
    const { parts, openTab } = setUp();
    parts.add(recordingPart('thirty', 30).part);
    parts.add(recordingPart('ten', 10).part);
    parts.add(recordingPart('twenty', 20, { shrinksLast: true }).part);
    parts.add(recordingPart('twenty-later', 20).part);

    const { root } = openTab();

    expect(sectionOrder(root)).toEqual([
      'ten',
      'twenty',
      'twenty-later',
      'thirty',
    ]);
    expect(
      root
        .querySelectorAll('[data-shrinks-last]')
        .map((wrapper) => wrapper.dataset.part),
    ).toEqual(['twenty']);
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

  it('sessionPart_DefaultLayout_FramesItHeadlessWithItsBody', () => {
    const { parts, openTab } = setUp();
    parts.add(recordingPart('chat.session', 0).part);

    const { root } = openTab();

    const [wrapper] = findAll(root, 'chat-side-part');
    expect({
      headed: findAll(wrapper, 'chat-side-section-head').length,
      header: findAll(wrapper, 'chat-side-header').length,
      content: wrapper.textContent,
    }).toEqual({ headed: 0, header: 1, content: 'content chat.session' });
  });

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

  // Breaks if a hold writes the user's hub or section choice, or leaves the hub
  // or the section shown after its last dispose.
  it.each<{
    case: string;
    initial: Record<string, unknown>;
    hold(sections: SideSections): Disposable;
    during?(sections: SideSections): void;
    expected: {
      during: { hidden: boolean; collapsed: boolean };
      after: { hidden: boolean; collapsed: boolean };
      sets: [string, unknown][];
    };
  }>([
    {
      case: 'one hold on a hidden hub and a collapsed a',
      initial: { [HIDDEN]: true, [COLLAPSED]: ['a'] },
      hold: (sections) => sections.showForNow('a'),
      expected: {
        during: { hidden: false, collapsed: false },
        after: { hidden: true, collapsed: true },
        sets: [],
      },
    },
    {
      case: 'two holds on a, the first disposed twice',
      initial: { [HIDDEN]: true, [COLLAPSED]: ['a'] },
      hold: (sections) => {
        const first = sections.showForNow('a');
        const second = sections.showForNow('a');
        first.dispose();
        first.dispose();
        return second;
      },
      expected: {
        during: { hidden: false, collapsed: false },
        after: { hidden: true, collapsed: true },
        sets: [],
      },
    },
    {
      case: 'a hold on b with a collapsed',
      initial: { [HIDDEN]: true, [COLLAPSED]: ['a'] },
      hold: (sections) => sections.showForNow('b'),
      expected: {
        during: { hidden: false, collapsed: true },
        after: { hidden: true, collapsed: true },
        sets: [],
      },
    },
    {
      case: 'a user toggleHidden during the hold',
      initial: { [HIDDEN]: false },
      hold: (sections) => sections.showForNow('a'),
      during: (sections) => sections.toggleHidden(),
      expected: {
        during: { hidden: false, collapsed: false },
        after: { hidden: true, collapsed: false },
        sets: [[HIDDEN, true]],
      },
    },
    {
      case: "a user toggleSection('a') during the hold",
      initial: { [HIDDEN]: false, [COLLAPSED]: [] },
      hold: (sections) => sections.showForNow('a'),
      during: (sections) => sections.toggleSection('a'),
      expected: {
        during: { hidden: false, collapsed: false },
        after: { hidden: false, collapsed: true },
        sets: [[COLLAPSED, ['a']]],
      },
    },
  ])(
    'showForNow_Hold_ShowsTheHubAndSectionAndRestores: $case',
    ({ initial, hold, during, expected }) => {
      const { uiState, sets } = recordingUiState(initial);
      const { parts, sections, openTab } = setUp(uiState);
      parts.add(recordingPart('a', 10).part);
      parts.add(recordingPart('b', 20).part);
      const { root } = openTab();
      const shownState = () => ({
        hidden: root.classList.contains('is-side-hidden'),
        collapsed: sectionFrameOf(root, 'a').classList.contains('is-collapsed'),
      });

      const handle = hold(sections);
      during?.(sections);
      const whileHeld = shownState();
      handle.dispose();

      expect({ during: whileHeld, after: shownState(), sets }).toEqual(
        expected,
      );
    },
  );
});

// A fake `uiState` that records each `set`, in order.
function recordingUiState(initial: Record<string, unknown>) {
  const held = fakeUiState(initial);
  const sets: [string, unknown][] = [];
  const uiState: UiState = {
    get: (key) => held.get(key),
    set: (key, value) => {
      sets.push([key, value]);
      held.set(key, value);
    },
  };
  return { uiState, sets };
}

// The section frame of part `partId` in `root`.
function sectionFrameOf(root: FakeElement, partId: string) {
  const wrapper = findAll(root, 'chat-side-part').find(
    (each) => each.dataset.part === partId,
  );
  if (wrapper === undefined) {
    throw new Error(`no wrapper for part ${partId}`);
  }
  return findAll(wrapper, 'chat-side-section')[0];
}

// The heads whose section is in `ids` get a layout box, as a drawn head has,
// and the holder gets one too.
function showHeads(root: FakeElement, ids: readonly string[]) {
  holderOf(root).hasLayoutBox = true;
  for (const wrapper of findAll(root, 'chat-side-part')) {
    const head = findAll(wrapper, 'chat-side-section-head')[0];
    if (head !== undefined) {
      head.hasLayoutBox = ids.includes(wrapper.dataset.part);
    }
  }
}

// The part ids whose head carries the cursor's mark.
function markedParts(root: FakeElement): string[] {
  return findAll(root, 'chat-side-part')
    .filter((wrapper) =>
      findAll(wrapper, 'chat-side-section-head').some((head) =>
        head.classList.contains('is-cursor'),
      ),
    )
    .map((wrapper) => wrapper.dataset.part);
}

// A layout whose section frame has no update, so each frame change draws a new
// head.
const REDRAWN_FRAME: ChatLayout = {
  sideSection(parent, input, kit) {
    const section = document.createElement('section');
    section.className = 'chat-side-section';
    section.classList.toggle('is-collapsed', input.collapsed);
    parent.append(section);
    kit.head(section);
    kit.body(section);
    return { element: section };
  },
};

describe('the section cursor', () => {
  beforeEach(() =>
    installFocusFakeDom((name, value) => vi.stubGlobal(name, value)),
  );
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  type Step = (cursor: SectionCursor) => string | null;
  const enter: Step = (cursor) => cursor.enter();
  const down: Step = (cursor) => cursor.move(1);
  const up: Step = (cursor) => cursor.move(-1);
  const first: Step = (cursor) => cursor.toEdge('first');
  const last: Step = (cursor) => cursor.toEdge('last');

  // Four parts in hub order a, b, c, d; b draws a head with no layout box.
  it.each<{
    case: string;
    given: Step[];
    removes?: string;
    act: Step;
    title: string;
    marked: string;
  }>([
    {
      case: 'enter, first time',
      given: [],
      act: enter,
      title: 'Title a',
      marked: 'a',
    },
    {
      case: 'move(1) skips the hidden section',
      given: [enter],
      act: down,
      title: 'Title c',
      marked: 'c',
    },
    {
      case: 'move(-1) skips it back',
      given: [enter, down],
      act: up,
      title: 'Title a',
      marked: 'a',
    },
    {
      case: 'move(1) on the last stays',
      given: [enter, last],
      act: down,
      title: 'Title d',
      marked: 'd',
    },
    {
      case: 'move(-1) on the first stays',
      given: [enter],
      act: up,
      title: 'Title a',
      marked: 'a',
    },
    {
      case: "toEdge('first')",
      given: [enter, last],
      act: first,
      title: 'Title a',
      marked: 'a',
    },
    {
      case: "toEdge('last')",
      given: [enter],
      act: last,
      title: 'Title d',
      marked: 'd',
    },
    {
      case: 'enter keeps the cursor',
      given: [enter, down],
      act: enter,
      title: 'Title c',
      marked: 'c',
    },
    {
      case: "enter with the cursor's section removed",
      given: [enter, down],
      removes: 'c',
      act: enter,
      title: 'Title a',
      marked: 'a',
    },
    {
      case: "move(1) with the cursor's section removed",
      given: [enter, last],
      removes: 'd',
      act: down,
      title: 'Title a',
      marked: 'a',
    },
  ])(
    'sectionCursor_Walk_StopsAtEndsAndSkipsHiddenSections: $case',
    ({ given, removes, act, title, marked }) => {
      const { parts, openTab } = setUp();
      const added = new Map(
        ['a', 'b', 'c', 'd'].map((id, index) => [
          id,
          parts.add(recordingPart(id, (index + 1) * 10).part),
        ]),
      );
      const { root, side } = openTab();
      showHeads(root, ['a', 'c', 'd']);
      for (const step of given) {
        step(side.cursor);
      }
      if (removes !== undefined) {
        added.get(removes)?.dispose();
        side.sync();
      }

      expect(act(side.cursor)).toBe(title);
      expect(markedParts(root)).toEqual([marked]);
    },
  );

  it.each<{ case: string; given: Step[]; act: Step }>([
    { case: 'enter', given: [], act: enter },
    { case: 'move(-1) from the first titled', given: [enter], act: up },
    { case: "toEdge('first')", given: [enter, last], act: first },
  ])(
    'sectionCursor_SessionHeader_CursorPassesOverIt: $case',
    ({ given, act }) => {
      const { parts, openTab } = setUp();
      parts.add(recordingPart('chat.session', 0).part);
      parts.add(recordingPart('a', 10).part);
      parts.add(recordingPart('b', 20).part);
      const { root, side } = openTab();
      showHeads(root, ['a', 'b']);
      for (const step of given) {
        step(side.cursor);
      }

      expect(act(side.cursor)).toBe('Title a');
      expect(markedParts(root)).toEqual(['a']);
    },
  );

  it('sectionCursor_Toggle_FoldsTheCursorsSectionAndKeepsTheMark', () => {
    const { parts, layouts, uiState, logs, openTab } = setUp();
    layouts.set(withUser<ChatLayout>(defaultLayout, REDRAWN_FRAME));
    parts.add(recordingPart('a', 10).part);
    parts.add(recordingPart('b', 20).part);
    const { root, side } = openTab();
    showHeads(root, ['a', 'b']);
    side.cursor.enter();
    side.cursor.move(1);
    const headBefore = findAll(root, 'chat-side-section-head')[1];

    expect(side.cursor.toggle()).toBe('Title b');

    expect(uiState.get(COLLAPSED)).toEqual(['b']);
    expect(logs).toContain('section Title b collapsed');
    expect(findAll(root, 'chat-side-section-head')[1]).not.toBe(headBefore);
    expect(markedParts(root)).toEqual(['b']);

    showHeads(root, ['a', 'b']);
    side.cursor.toggle();

    expect(uiState.get(COLLAPSED)).toEqual([]);
    expect(logs).toContain('section Title b expanded');
    expect(markedParts(root)).toEqual(['b']);
  });

  it.each<{
    case: string;
    hidden: boolean;
    holderBox: boolean;
    shownHeads: string[];
    reachable: boolean;
  }>([
    {
      case: 'hub hidden',
      hidden: true,
      holderBox: true,
      shownHeads: ['a'],
      reachable: false,
    },
    {
      case: 'holder with no layout box',
      hidden: false,
      holderBox: false,
      shownHeads: ['a'],
      reachable: false,
    },
    {
      case: 'no head shown',
      hidden: false,
      holderBox: true,
      shownHeads: [],
      reachable: false,
    },
    {
      case: 'one shown head',
      hidden: false,
      holderBox: true,
      shownHeads: ['a'],
      reachable: true,
    },
  ])(
    'sectionCursor_IsReachable: $case',
    ({ hidden, holderBox, shownHeads, reachable }) => {
      const { parts, openTab } = setUp(fakeUiState({ [HIDDEN]: hidden }));
      parts.add(recordingPart('a', 10).part);
      parts.add(recordingPart('b', 20).part);
      const { root, side } = openTab();
      showHeads(root, shownHeads);
      holderOf(root).hasLayoutBox = holderBox;

      expect(side.cursor.isReachable()).toBe(reachable);
    },
  );

  // Breaks: `leave` blurring the holder alone, a no-op while an element in it
  // holds the focus; `leave` taking the focus from outside the hub.
  it.each<{ case: string; focused: 'holder' | 'inside' | 'outside' }>([
    { case: 'the holder focused', focused: 'holder' },
    { case: 'an element in the holder focused', focused: 'inside' },
    { case: 'an element outside the hub focused', focused: 'outside' },
  ])('sectionCursor_Leave_TakesTheFocusOffTheHub: $case', ({ focused }) => {
    const { parts, openTab } = setUp();
    parts.add(recordingPart('a', 10).part);
    const { root, side } = openTab();
    const holder = holderOf(root) as FocusFakeElement;
    const target = {
      holder,
      inside: findAll(root, 'chat-side-section-body')[0] as FocusFakeElement,
      outside: document.createElement('div') as unknown as FocusFakeElement,
    }[focused];
    target.focus();

    side.cursor.leave();

    const doc = document as unknown as FocusFakeDocument;
    expect(doc.activeElement).toBe(focused === 'outside' ? target : null);
  });

  it('sectionCursor_ScrollBy_ScrollsTheCursorsBody', () => {
    vi.stubGlobal('getComputedStyle', () => ({ lineHeight: '18px' }));
    const { parts, openTab } = setUp();
    parts.add(recordingPart('a', 10).part);
    parts.add(recordingPart('b', 20).part);
    const { root, side } = openTab();
    showHeads(root, ['a', 'b']);
    const body = findAll(root, 'chat-side-section-body')[1];
    Object.assign(body, { scrollHeight: 500, clientHeight: 100 });
    side.cursor.enter();
    side.cursor.move(1);

    const scrolled = side.cursor.scrollBy('line', 1);

    expect(scrolled).toEqual({
      title: 'Title b',
      scroll: { moved: true, atEnd: false },
    });
    expect(body.scrollTop).toBe(18);
  });

  it('hubDivider_NudgeLeftThenRight_Widens24pxAndReturnsTo264', () => {
    const { uiState, openTab, logs } = setUp();
    const { root, side } = openTab();
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 1000,
      height: 500,
    });
    findAll(root, 'chat-side-handle')[0].hasLayoutBox = true;

    expect(side.divider.nudge('left')).toBe(true);
    expect(holderOf(root).style['--chat-side-width']).toBe('288');
    expect(uiState.get(WIDTH)).toBe(288);
    expect(logs).toContain('session hub width 288');

    side.divider.nudge('right');

    expect(holderOf(root).style['--chat-side-width']).toBe('264');
    expect(logs.at(-1)).toBe('session hub width 264');
  });
});
