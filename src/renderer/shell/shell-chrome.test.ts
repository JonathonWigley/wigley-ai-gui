import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';
import type { Area, Mode, ModeHandle } from '../../contracts/plugin';
import type { ConfigProblem } from '../../contracts/settings';
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
import type { Layout } from './layouts/layout';
import { mountShellChrome } from './shell-chrome';

// An area that appends each contribution to `root`, its alignment as
// `data-align`, in the order contributed.
function fakeArea() {
  const root = new FakeElement('div');
  const area: Area = {
    contribute(element, options) {
      element.dataset.align = options?.align ?? 'start';
      root.append(asFake(element));
      return { dispose: () => asFake(element).remove() };
    },
  };
  return { area, root };
}

// The command the chrome's commands register, which `mine` hints unless told
// otherwise.
const REGISTERED = 'docs.openDoc';

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

function mode(id: string, title: string): Mode {
  return {
    id,
    title,
    icon: 'book',
    element: asHtml(new FakeElement('div')),
    shown: () => undefined,
    hidden: () => undefined,
  };
}

function handle(): ModeHandle & { show: Mock<() => void> } {
  return {
    show: vi.fn<() => void>(),
    isShown: () => false,
    setContext: () => undefined,
    toggleSideBar: () => undefined,
    picked: () => undefined,
    sideBarShown: () => false,
  };
}

// The chrome over fake title and activity bars, in the dev app.
function mountChrome() {
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
      },
      commands: { exists: (id) => id === REGISTERED, run: () => undefined },
      platform: 'macos',
    },
    instance: { id: 'wigley-ai-gui-dev', displayName: 'Auri Dev', isDev: true },
    log: () => undefined,
  });
  return {
    chrome,
    titleBar: titleBar.area,
    titleBarRoot: titleBar.root,
    activityBar: activityBar.root,
  };
}

// The part drawn in each slot of `area`, in slot order.
function parts(area: FakeElement): (FakeElement | undefined)[] {
  return area.children.map((slot) => slot.children[0]);
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

    const items = parts(activityBar).map((item) => [
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
    const itemsBefore = parts(activityBar);

    chrome.setLayouts(shownMine());

    expect(titleBarRoot.children).toEqual(titleChildren);
    expect(activityBar.children).toEqual(activitySlots);
    const items = parts(activityBar);
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
    { row: 'an unregistered command', hinted: 'docs.missing', anchors: [] },
  ])(
    'setKeys_UserItemHint_AnchorsOnlyARegisteredCommandAndDisposesTheLastDraw: $row',
    ({ hinted, anchors }) => {
      const { chrome } = mountChrome();
      chrome.addMode(mode('docs', 'Docs'), handle());
      chrome.setLayouts(shownMine(hinted));
      const first = recordingAnchors();
      const second = recordingAnchors();

      chrome.setKeys(first.keys);
      chrome.setKeys(second.keys);

      expect(
        [...first.anchors, ...second.anchors].map((anchor) => [
          anchor.command,
          anchor.scope,
          anchor.isDisposed,
        ]),
      ).toEqual(anchors);
    },
  );

  it('activityItem_Click_ShowsItsMode', () => {
    const { chrome, activityBar } = mountChrome();
    const sessions = handle();
    const docs = handle();
    chrome.addMode(mode('sessions', 'Sessions'), sessions);
    chrome.addMode(mode('docs', 'Docs'), docs);
    chrome.setLayouts(shownMine());

    parts(activityBar)[1]?.click();

    expect(docs.show).toHaveBeenCalledTimes(1);
    expect(sessions.show).not.toHaveBeenCalled();
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
});
