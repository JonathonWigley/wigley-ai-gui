import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';
import type {
  Area,
  KeyHints,
  Mode,
  ModeHandle,
  ModePlace,
} from '../../contracts/plugin';
import type {
  ActivityBarSetting,
  ConfigProblem,
} from '../../contracts/settings';
import {
  recordingAnchors,
  withUser,
} from '../../shared/page/layout-host/test-layouts';
import {
  asFake,
  asHtml,
  FakeElement,
  type FocusFakeDocument,
  FocusFakeElement,
  installFocusFakeDom,
} from '../../shared/page/test-dom';
import defaultLayout from './layouts/default/layout.js';
import type {
  ActivityItemInput,
  ActivityPinInput,
  Layout,
  ToastTone,
} from './layouts/layout';
import { mountShellChrome } from './shell-chrome';
import { NO_FENCES } from '../../shared/page/markdown-mount.test-support';
import { noLayoutState } from '../../shared/page/layout-host/fake-layout-state.test-support';

const ALIGN_RANKS: Record<string, number> = { start: 0, center: 1, end: 2 };

// An area that puts each contribution in `root`, its alignment as
// `data-align` and its `order` (default 0) as `data-order`, sorted by
// alignment then order, a tie keeping the order contributed.
function fakeArea() {
  const root = new FakeElement('div');
  const ranks = new Map<FakeElement, number>();
  const area: Area = {
    contribute(element, options) {
      const fake = asFake(element);
      const align = options?.align ?? 'start';
      const order = options?.order ?? 0;
      element.dataset.align = align;
      element.dataset.order = String(order);
      const rank = ALIGN_RANKS[align] * 1000 + order;
      ranks.set(fake, rank);
      const following = root.children.find(
        (child) => (ranks.get(child) ?? 0) > rank,
      );
      if (following === undefined) {
        root.append(fake);
      } else {
        root.insertBefore(fake, following);
      }
      return { dispose: () => fake.remove() };
    },
  };
  return { area, root };
}

// The commands the chrome's commands register, which `mine` hints unless told
// otherwise.
const REGISTERED = 'docs.openDoc';
const TOGGLE_PIN = 'activityBar.togglePin';

// A user layout `mine` that defines only `activityItem`, ending each item
// with a hint for `hinted`.
function shownMine(hinted = REGISTERED) {
  const mine: Layout = {
    activityItem(parent, input, kit) {
      const item = kit.el(parent, 'button', 'mine-item', input.title);
      kit.keyHint(item, hinted);
      return item;
    },
  };
  return withUser(defaultLayout, mine);
}

// A user layout drawing each bar part as one line of text: an item as its
// title, a divider as `|` and the Pin button as `pin`; `items` and `pins`
// hold every input drawn, in order.
function shownBarText() {
  const items: ActivityItemInput[] = [];
  const pins: ActivityPinInput[] = [];
  const mine: Layout = {
    activityItem(parent, input, kit) {
      items.push(input);
      return kit.el(parent, 'span', '', input.title);
    },
    activityDivider: (parent, kit) => kit.el(parent, 'span', '', '|'),
    activityPin(parent, input, kit) {
      pins.push(input);
      return kit.el(parent, 'span', '', 'pin');
    },
  };
  return { shown: withUser(defaultLayout, mine), items, pins };
}

function mode(
  id: string,
  title: string,
  extra: { place?: ModePlace; showCommand?: string } = {},
): Mode {
  return {
    id,
    title,
    icon: 'book',
    element: asHtml(new FakeElement('div')),
    shown: () => undefined,
    hidden: () => undefined,
    focusMain: () => undefined,
    ...extra,
  };
}

function handle(): ModeHandle & { show: Mock<() => void> } {
  return {
    show: vi.fn<() => void>(),
    isShown: () => false,
    setContext: () => undefined,
    setCount: () => undefined,
    toggleSideBar: () => undefined,
    picked: () => undefined,
    sideBarShown: () => false,
    dispose: () => undefined,
  };
}

// The chrome over fake title and activity bars, in the dev app. `runs` holds
// each command run through the kit, with its arg.
function mountChrome(keys: KeyHints = recordingAnchors().keys) {
  const runs: [string, unknown][] = [];
  const titleBar = fakeArea();
  const activityBar = fakeArea();
  const chrome = mountShellChrome({
    areas: { titleBar: titleBar.area, activityBar: activityBar.area },
    defaultLayout,
    services: {
      markdown: {
        block: (text) => text,
        inline: (text) => text,
        document: async (text) => text,
        ...NO_FENCES,
      },
      keys,
      commands: {
        exists: (id) => id === REGISTERED || id === TOGGLE_PIN,
        argShape: () => undefined,
        run: (id, arg) => {
          runs.push([id, arg]);
        },
      },
      platform: 'macos',
      state: noLayoutState,
    },
    instance: { id: 'wigley-ai-gui-dev', displayName: 'Auri Dev', isDev: true },
    log: () => undefined,
  });
  return {
    chrome,
    runs,
    titleBar: titleBar.area,
    titleBarRoot: titleBar.root,
    activityBar: activityBar.root,
  };
}

// The part drawn in each slot of `area`, in slot order.
function parts(area: FakeElement): (FakeElement | undefined)[] {
  return area.children.map((slot) => slot.children[0]);
}

// The part drawn in each `start` slot of the activity bar: the top groups'
// items, which hold every mode added with no place.
function topParts(area: FakeElement): (FakeElement | undefined)[] {
  return area.children
    .filter((slot) => slot.dataset.align === 'start')
    .map((slot) => slot.children[0]);
}

// Each activity bar slot as `<align> <order> <text>`, in slot order.
function barSlots(area: FakeElement): string[] {
  return area.children.map(
    (slot) =>
      `${slot.dataset.align} ${slot.dataset.order} ${slot.children[0]?.textContent}`,
  );
}

function slotAligned(area: FakeElement, align: string): FakeElement {
  return area.children.find((slot) => slot.dataset.align === align)!;
}

describe('mountShellChrome', () => {
  let doc: FocusFakeDocument;
  beforeEach(() => {
    doc = installFocusFakeDom((name, value) => vi.stubGlobal(name, value));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('setLayouts_UserDefinesActivityItem_ItemsFromUserContextFromDefault', () => {
    const { chrome, titleBarRoot: titleBar, activityBar } = mountChrome();
    chrome.addMode(mode('sessions', 'Sessions'), handle());
    chrome.addMode(mode('docs', 'Docs'), handle());
    chrome.showContext({ title: 'Docs', detail: 'AGENTS.md' });

    chrome.setLayouts(shownMine());

    const items = topParts(activityBar).map((item) => [
      item?.className,
      item?.dataset.layout,
      item?.dataset.layoutOwner,
    ]);
    expect(items).toEqual([
      ['mine-item', 'mine', 'shell'],
      ['mine-item', 'mine', 'shell'],
    ]);
    const context = slotAligned(titleBar, 'center').children[0];
    expect(context.className).toBe('title-bar-context');
    expect(context.dataset.layout).toBe('default');
    expect(context.dataset.layoutOwner).toBe('shell');
  });

  it('setLayouts_Redraw_KeepsSlotOrderShownMarkAndFocus', () => {
    const { chrome, titleBar, titleBarRoot, activityBar } = mountChrome();
    const focused = new FocusFakeElement('input');
    titleBar.contribute(asHtml(focused), { align: 'end' });
    focused.focus();
    chrome.addMode(mode('sessions', 'Sessions'), handle());
    chrome.addMode(mode('docs', 'Docs'), handle());
    chrome.showContext({ title: 'Sessions', detail: null });
    chrome.showProblems([{ file: 'settings.json', message: 'bad' }]);
    chrome.markMode('sessions');
    const titleChildren = [...titleBarRoot.children];
    const activitySlots = [...activityBar.children];
    const itemsBefore = topParts(activityBar);

    chrome.setLayouts(shownMine());

    expect(titleBarRoot.children).toEqual(titleChildren);
    expect(activityBar.children).toEqual(activitySlots);
    const items = topParts(activityBar);
    expect(items[0]).not.toBe(itemsBefore[0]);
    expect(
      items.map((item) => [
        item?.classList.contains('is-shown'),
        item?.attributes.get('aria-current'),
      ]),
    ).toEqual([
      [true, 'true'],
      [false, undefined],
    ]);
    expect(focused.parentNode).toBe(titleBarRoot);
    expect(doc.activeElement).toBe(focused);
  });

  it.each([
    {
      row: 'a registered command',
      hinted: REGISTERED,
      anchors: [
        [REGISTERED, undefined, true],
        [REGISTERED, undefined, false],
      ],
    },
    {
      row: 'a command no plugin registers yet',
      hinted: 'docs.missing',
      anchors: [
        ['docs.missing', undefined, true],
        ['docs.missing', undefined, false],
      ],
    },
  ])(
    'setLayouts_UserItemHint_AnchorsTheCommandAndDisposesTheLastDraw: $row',
    ({ hinted, anchors }) => {
      const recorded = recordingAnchors();
      const { chrome } = mountChrome(recorded.keys);
      chrome.addMode(mode('docs', 'Docs'), handle());

      chrome.setLayouts(shownMine(hinted));
      chrome.setLayouts(shownMine(hinted));

      expect(
        recorded.anchors
          .filter((anchor) => anchor.command === hinted)
          .map((anchor) => [anchor.command, anchor.scope, anchor.isDisposed]),
      ).toEqual(anchors);
    },
  );

  // Breaks if the default item anchors a key for a mode with no show command,
  // or anchors the unqualified or no id for one with it.
  it.each([
    {
      row: 'a show command',
      showCommand: 'docs.showMode',
      anchors: ['docs.showMode'],
    },
    { row: 'no show command', showCommand: undefined, anchors: [] },
  ])(
    'activityItem_ShowCommand_DefaultAnchorsItsKey: $row',
    ({ showCommand, anchors }) => {
      const recorded = recordingAnchors();
      const { chrome } = mountChrome(recorded.keys);

      chrome.addMode(mode('docs.docs', 'Docs', { showCommand }), handle());

      expect(
        recorded.anchors
          .filter((anchor) => anchor.command !== TOGGLE_PIN)
          .map((anchor) => anchor.command),
      ).toEqual(anchors);
    },
  );

  it('activityItem_Click_RunsModesShowWithItsId', () => {
    const { chrome, runs, activityBar } = mountChrome();
    const docs = handle();
    chrome.addMode(mode('sessions.sessions', 'Sessions'), handle());
    chrome.addMode(mode('docs.docs', 'Docs'), docs);
    chrome.setLayouts(shownMine());

    topParts(activityBar)[1]?.click();

    expect(runs).toEqual([['modes.show', 'docs.docs']]);
    expect(docs.show).not.toHaveBeenCalled();
  });

  // The default layout's bar parts. Breaks if the Pin button runs its command
  // outside the kit, or the divider draws nothing.
  it('activityPinAndDivider_Default_PinRunsTogglePinAndDividerDraws', () => {
    const { chrome, runs, activityBar } = mountChrome();
    chrome.addMode(
      mode('sessions.sessions', 'Sessions', { place: { group: 1, order: 1 } }),
      handle(),
    );
    chrome.addMode(
      mode('docs.docs', 'Docs', { place: { group: 2, order: 1 } }),
      handle(),
    );

    parts(activityBar).at(-1)?.click();

    expect(runs).toEqual([[TOGGLE_PIN, undefined]]);
    expect(
      parts(activityBar).map((part) =>
        part?.classList.contains('activity-divider'),
      ),
    ).toEqual([false, true, false, false]);
  });

  // `slots`: each slot as `<align> <order> <text>`. Breaks if a group lands on
  // the wrong edge, a divider goes missing or sits before the pin, an order
  // skips the dividers or the pin, the setting fails to redraw the bar, or a
  // hidden mode keeps its item.
  it.each<{
    row: string;
    setting: ActivityBarSetting;
    slots: string[];
  }>([
    {
      row: 'the suggested places',
      setting: { groups: [], hidden: [] },
      slots: [
        'start 0 Sessions',
        'start 1 Inbox',
        'start 2 |',
        'start 3 Docs',
        'start 4 |',
        'start 5 Notes',
        'end 0 Gallery',
        'end 1 Settings',
        'end 2 pin',
      ],
    },
    {
      row: 'a setting that lists groups',
      setting: {
        groups: [
          { modes: ['docs.docs', 'sessions.sessions'] },
          { modes: ['settings.settings'], at: 'bottom' },
        ],
        hidden: [],
      },
      slots: [
        'start 0 Docs',
        'start 1 Sessions',
        'start 2 |',
        'start 3 Inbox',
        'start 4 Gallery',
        'start 5 Notes',
        'end 0 Settings',
        'end 1 pin',
      ],
    },
    {
      row: 'a hidden mode',
      setting: { groups: [], hidden: ['docs.docs', 'settings.settings'] },
      slots: [
        'start 0 Sessions',
        'start 1 Inbox',
        'start 2 |',
        'start 3 Notes',
        'end 0 Gallery',
        'end 1 pin',
      ],
    },
  ])(
    'setActivityBar_Setting_DrawsTheBarInOrder: $row',
    ({ setting, slots }) => {
      const { chrome, activityBar } = mountChrome();
      const bar = shownBarText();
      chrome.setLayouts(bar.shown);
      const added: [string, string, ModePlace | undefined][] = [
        ['settings.settings', 'Settings', { group: 3, order: 2, at: 'bottom' }],
        ['notes.notes', 'Notes', undefined],
        ['docs.docs', 'Docs', { group: 2, order: 1 }],
        ['work-inbox.main', 'Inbox', { group: 1, order: 2 }],
        ['gallery.gallery', 'Gallery', { group: 3, order: 1, at: 'bottom' }],
        ['sessions.sessions', 'Sessions', { group: 1, order: 1 }],
      ];
      for (const [id, title, place] of added) {
        chrome.addMode(mode(id, title, { place }), handle());
      }

      chrome.setActivityBar(setting);

      expect(barSlots(activityBar)).toEqual(slots);
    },
  );

  // `drawn`: the docs item's count on each draw the sets cause. Breaks if 0 or
  // a negative shows, a cleared count stays, or a count redraws other items.
  it.each<{
    row: string;
    sets: (number | null)[];
    drawn: (number | null)[];
  }>([
    { row: 'two', sets: [2], drawn: [2] },
    { row: 'zero', sets: [0], drawn: [null] },
    { row: 'a negative', sets: [-3], drawn: [null] },
    { row: 'null', sets: [null], drawn: [null] },
    { row: 'set then cleared', sets: [4, null], drawn: [4, null] },
  ])('setCount_Count_ItemShowsACountAboveZero: $row', ({ sets, drawn }) => {
    const { chrome, activityBar } = mountChrome();
    const bar = shownBarText();
    chrome.setLayouts(bar.shown);
    chrome.addMode(mode('sessions.sessions', 'Sessions'), handle());
    chrome.addMode(mode('docs.docs', 'Docs'), handle());
    const sessionsItem = topParts(activityBar)[0];
    bar.items.length = 0;

    for (const set of sets) {
      chrome.setCount('docs.docs', set);
    }

    expect(bar.items.map((input) => [input.id, input.count])).toEqual(
      drawn.map((count) => ['docs.docs', count]),
    );
    expect(topParts(activityBar)[0]).toBe(sessionsItem);
  });

  // Breaks if a mode added again keeps the count its last add set.
  it('addMode_AfterADispose_DrawsWithNoCount', () => {
    const { chrome } = mountChrome();
    const bar = shownBarText();
    chrome.setLayouts(bar.shown);
    const sessions = chrome.addMode(
      mode('sessions.sessions', 'Sessions'),
      handle(),
    );
    chrome.setCount('sessions.sessions', 5);
    sessions.dispose();
    bar.items.length = 0;

    chrome.addMode(mode('sessions.sessions', 'Sessions'), handle());

    expect(bar.items.map((input) => [input.id, input.count])).toEqual([
      ['sessions.sessions', null],
    ]);
  });

  it('setActivityPinned_Pinned_DrawsThePinAgainWithIt', () => {
    const { chrome, activityBar } = mountChrome();
    const bar = shownBarText();
    chrome.setLayouts(bar.shown);
    bar.pins.length = 0;

    chrome.setActivityPinned(true);
    chrome.setActivityPinned(false);

    expect(bar.pins).toEqual([{ pinned: true }, { pinned: false }]);
    expect(barSlots(activityBar)).toEqual(['end 0 pin']);
  });

  // Breaks if a mode added again appends its item at the end of the bar: a
  // restarted plugin's icon moves.
  it.each([
    {
      row: 'added again',
      id: 'sessions',
      title: 'Sessions',
      items: ['Sessions', 'Docs', 'Gallery'],
    },
    {
      row: 'a new id',
      id: 'notes',
      title: 'Notes',
      items: ['Docs', 'Gallery', 'Notes'],
    },
  ])(
    'addMode_AfterADispose_TakesThePlaceOfItsIdsFirstAdd: $row',
    ({ id, title, items }) => {
      const { chrome, activityBar } = mountChrome();
      chrome.setLayouts(shownMine());
      const sessions = chrome.addMode(mode('sessions', 'Sessions'), handle());
      chrome.addMode(mode('docs', 'Docs'), handle());
      chrome.addMode(mode('gallery', 'Gallery'), handle());
      sessions.dispose();

      chrome.addMode(mode(id, title), handle());

      expect(topParts(activityBar).map((item) => item?.textContent)).toEqual(
        items,
      );
    },
  );

  it('showMode_KnownId_ShowsThroughTheHandle', () => {
    const { chrome } = mountChrome();
    const sessions = handle();
    const docs = handle();
    chrome.addMode(mode('sessions.sessions', 'Sessions'), sessions);
    chrome.addMode(mode('docs.docs', 'Docs'), docs);

    chrome.showMode('docs.docs');

    expect(docs.show).toHaveBeenCalledTimes(1);
    expect(sessions.show).not.toHaveBeenCalled();
  });

  it('showMode_UnknownId_DoesNothing', () => {
    const { chrome } = mountChrome();
    const docs = handle();
    chrome.addMode(mode('docs.docs', 'Docs'), docs);

    chrome.showMode('docs');

    expect(docs.show).not.toHaveBeenCalled();
  });

  it('addMode_Dispose_RemovesTheActivityItem', () => {
    const { chrome, runs, activityBar } = mountChrome();
    const added = chrome.addMode(
      mode('sessions.sessions', 'Sessions'),
      handle(),
    );
    chrome.addMode(mode('docs.docs', 'Docs'), handle());

    added.dispose();

    expect(topParts(activityBar).length).toBe(1);
    topParts(activityBar)[0]?.click();
    expect(runs).toEqual([['modes.show', 'docs.docs']]);
  });

  // `text` and `title`: what the badge's text and tooltip match; null for a
  // hidden slot with no badge.
  it.each([
    { case: 'none', shows: [[]], text: null, title: null },
    {
      case: 'one',
      shows: [[{ file: 'settings.json', message: 'bad value' }]],
      text: /settings\.json: bad value/,
      title: /bad value/,
    },
    {
      case: 'two',
      shows: [
        [
          { file: 'a.json', message: 'x' },
          { file: 'b.json', message: 'y' },
        ],
      ],
      text: /2/,
      title: /a\.json[\s\S]*b\.json/,
    },
    {
      case: 'one then none',
      shows: [[{ file: 'settings.json', message: 'bad value' }], []],
      text: null,
      title: null,
    },
  ] satisfies {
    case: string;
    shows: ConfigProblem[][];
    text: RegExp | null;
    title: RegExp | null;
  }[])(
    'showProblems_Counts_DefaultBadgeTextAndHidden: $case',
    ({ shows, text, title }) => {
      const { chrome, titleBarRoot: titleBar } = mountChrome();

      for (const problems of shows) {
        chrome.showProblems(problems);
      }

      const slot = slotAligned(titleBar, 'end');
      const badge = slot.children[0];
      if (text === null) {
        expect(slot.hidden).toBe(true);
        expect(badge).toBeUndefined();
      } else {
        expect(slot.hidden).toBe(false);
        expect(badge.classList.contains('config-problem-badge')).toBe(true);
        expect(badge.textContent).toMatch(text);
        expect(badge.title).toMatch(title!);
      }
    },
  );

  // `dots`: each status dot's tag and status, in order. The user layout
  // leaves `toast` out, so `default` draws it. Breaks if a tone's dot goes
  // missing or appears for info, or the toast skips the layout host.
  it.each([
    { tone: 'success', text: 'Saved', dots: [['SPAN', 'success']] },
    { tone: 'info', text: 'Copied the path', dots: [] },
    { tone: 'error', text: 'Save failed', dots: [['SPAN', 'error']] },
  ] satisfies { tone: ToastTone; text: string; dots: string[][] }[])(
    'drawToast_Tone_DefaultDrawsTheDotOnlyForSuccessAndError: $tone',
    ({ tone, text, dots }) => {
      const { chrome } = mountChrome();
      chrome.setLayouts(shownMine());
      const layer = new FakeElement('div');

      const drawn = chrome.drawToast(asHtml(layer), { text, tone });

      const root = asFake(drawn.element);
      expect(layer.children).toEqual([root]);
      expect(root.classList.contains('ui-floating')).toBe(true);
      expect(root.classList.contains('toast')).toBe(true);
      expect(root.dataset.layoutOwner).toBe('shell');
      expect(root.dataset.layout).toBe('default');
      expect(root.querySelector('.toast-text')?.textContent).toBe(text);
      expect(
        root
          .querySelectorAll('.ui-dot')
          .map((dot) => [dot.tagName, dot.dataset.status]),
      ).toEqual(dots);
    },
  );
});
