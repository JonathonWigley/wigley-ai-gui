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
  Mode,
  ModeHandle,
  ShownLayouts,
} from '../../contracts/plugin';
import type { ConfigProblem } from '../../contracts/settings';
import { createBaseKit } from '../../shared/page/layout-host/base-kit';
import {
  asFake,
  asHtml,
  FakeElement,
  installFakeDom,
} from '../../shared/page/test-dom';
import defaultLayout from './layouts/default/layout.js';
import type { Layout } from './layouts/layout';
import { createShellKit, mountShellChrome } from './shell-chrome';

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

// A user layout `mine` that defines only `activityItem`.
const mine: Layout = {
  activityItem(parent, input, kit) {
    return kit.el(parent, 'button', 'mine-item', input.title);
  },
};

function shownMine(): ShownLayouts<Layout> {
  return {
    layouts: new Map<string, Layout>([
      ['default', defaultLayout],
      ['mine', mine],
    ]),
    user: 'mine',
  };
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
  const kit = createShellKit(
    createBaseKit({
      markdown: {
        block: (text) => text,
        inline: (text) => text,
        document: async (text) => text,
      },
      keys: {
        anchor: () => ({ dispose: () => undefined }),
        keysFor: () => null,
      },
      commands: { exists: () => false, run: () => undefined },
      scope: null,
      commandNamed: () => null,
      platform: 'macos',
    }),
  );
  const chrome = mountShellChrome({
    areas: { titleBar: titleBar.area, activityBar: activityBar.area },
    defaultLayout,
    kit,
    instance: { id: 'wigley-ai-gui-dev', displayName: 'Auri Dev', isDev: true },
    log: () => undefined,
  });
  return { chrome, titleBar: titleBar.root, activityBar: activityBar.root };
}

// The part drawn in each slot of `area`, in slot order.
function parts(area: FakeElement): (FakeElement | undefined)[] {
  return area.children.map((slot) => slot.children[0]);
}

function slotAligned(area: FakeElement, align: string): FakeElement {
  return area.children.find((slot) => slot.dataset.align === align)!;
}

describe('mountShellChrome', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('setLayouts_UserDefinesActivityItem_ItemsFromUserContextFromDefault', () => {
    const { chrome, titleBar, activityBar } = mountChrome();
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
    const { chrome, titleBar, activityBar } = mountChrome();
    const main = fakeArea();
    const focused = asHtml(new FakeElement('input'));
    main.area.contribute(focused);
    chrome.addMode(mode('sessions', 'Sessions'), handle());
    chrome.addMode(mode('docs', 'Docs'), handle());
    chrome.showContext({ title: 'Sessions', detail: null });
    chrome.showProblems([{ file: 'settings.json', message: 'bad' }]);
    chrome.markMode('sessions');
    const titleSlots = [...titleBar.children];
    const activitySlots = [...activityBar.children];
    const itemsBefore = parts(activityBar);

    chrome.setLayouts(shownMine());

    expect(titleBar.children).toEqual(titleSlots);
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
    expect(main.root.children).toEqual([asFake(focused)]);
  });

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
      const { chrome, titleBar } = mountChrome();

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
