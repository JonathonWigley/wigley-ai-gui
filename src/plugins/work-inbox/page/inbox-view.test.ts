import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandId } from '../../../contracts/commands';
import type { EditorHost } from '../../../contracts/editor';
import type { ToastTone } from '../../../contracts/plugin';
import { noLayoutState } from '../../../shared/page/layout-host/fake-layout-state.test-support';
import { recordingAnchors } from '../../../shared/page/layout-host/test-layouts';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import {
  asFake,
  type FakeElement,
  findAll,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import { countingEditors } from '../../../shared/plugin-part-harness.test-support';
import type { WorkItem, WorkJobStatus, WorkState } from '../../work/contract';
import { workItem } from '../../work/contract.test-support';
import type { WorkInboxPlace } from '../contract';
import { workInboxManifest } from '../manifest';
import type { InboxCardAction } from './inbox-state';
import { createInboxView, type InboxView } from './inbox-view';

const NOW = Date.parse('2026-11-23T12:00:00.000Z');

function work(
  items: WorkItem[],
  job: Partial<WorkState['job']> = {},
): WorkState {
  return {
    items,
    cards: [],
    suggestions: [],
    columns: [],
    job: { running: null, last: null, ...job },
    problem: null,
  };
}

function sweep(overrides: Partial<WorkJobStatus>): WorkJobStatus {
  return {
    kind: 'sweep',
    state: 'done',
    rowId: null,
    at: '2026-11-23T11:50:00.000Z',
    note: null,
    ...overrides,
  };
}

// One vim box the fake editor host made: its text, and whether it holds the focus or was destroyed.
interface FakeBox {
  text: string;
  isFocused: boolean;
  isDestroyed: boolean;
  type(text: string): void;
}

function fakeEditors(): { host: EditorHost; boxes: FakeBox[] } {
  const boxes: FakeBox[] = [];
  const host: EditorHost = {
    ...countingEditors().host,
    create(_parent, doc, events) {
      const box: FakeBox = {
        text: doc,
        isFocused: false,
        isDestroyed: false,
        type(text) {
          box.text = text;
          events.changed(text);
        },
      };
      boxes.push(box);
      return {
        text: () => box.text,
        setText(text) {
          box.text = text;
        },
        insert() {},
        charBeforeCursor: () => '',
        focus() {
          box.isFocused = true;
          events.focused();
        },
        blur() {
          if (box.isFocused) {
            box.isFocused = false;
            events.blurred();
          }
        },
        destroy() {
          box.isDestroyed = true;
        },
      };
    },
  };
  return { host, boxes };
}

// The card commands a button runs, as the page part routes them.
const ITEM_ACTIONS: Record<string, InboxCardAction> = {
  'work-inbox.dismissItem': 'dismiss',
  'work-inbox.restoreItem': 'restore',
  'work-inbox.snoozeItem': 'snooze',
  'work-inbox.addItemToBoard': 'addToBoard',
  'work-inbox.startItemSession': 'startSession',
};

interface SetupOptions {
  // Whether Inbox mode shows once the first state lands; true unless given.
  isShown?: boolean;
  savedPlace?: WorkInboxPlace;
  // The rejection text of each command id whose run fails.
  rejects?: Record<string, string>;
}

// An Inbox view over `state`, shown unless `isShown` is false. `runs` holds each reporting run as `[id, arg]`,
// `scopes` each scope set, `logs`, `toasts` and `places` what the view wrote, `boxes` each vim box made.
function inboxSetup(state: WorkState, options: SetupOptions = {}) {
  const runs: [CommandId, unknown][] = [];
  const scopes: string[] = [];
  const logs: string[] = [];
  const toasts: [string, ToastTone][] = [];
  const places: WorkInboxPlace[] = [];
  const editors = fakeEditors();
  const mode = { isShown: false };
  const { keys } = recordingAnchors();
  let view: InboxView | null = null;
  const show = () => {
    if (!mode.isShown) {
      mode.isShown = true;
      view?.shown();
    }
  };
  const created = createInboxView({
    log: (line) => logs.push(line),
    toast: (text, tone) => toasts.push([text, tone]),
    kitServices: {
      markdown: {
        block: (text) => text,
        inline: (text) => text,
        document: async (text) => text,
        ...NO_FENCES,
      },
      keys,
      commands: {
        exists: () => true,
        argShape(id) {
          const short = id.replace('work-inbox.', '');
          const declared = workInboxManifest.commands as Record<
            string,
            { arg?: 'string' }
          >;
          return id === 'core.openLink' ? 'string' : declared[short]?.arg;
        },
        run(id, arg) {
          const action = ITEM_ACTIONS[id];
          if (action !== undefined) {
            created.pressItem(action, String(arg));
          }
        },
      },
      platform: 'macos',
      state: noLayoutState,
    },
    editor: editors.host,
    timers: { set: () => 0, clear: () => undefined },
    now: () => NOW,
    setScope: (scope) => scopes.push(scope),
    setFocusTarget: () => undefined,
    setResizeTarget: () => undefined,
    isShown: () => mode.isShown,
    showMode: show,
    picked: () => undefined,
    setContext: () => undefined,
    runKey: () => undefined,
    async runFor(id, arg) {
      runs.push([id, arg]);
      const rejection = options.rejects?.[id];
      if (rejection !== undefined) {
        throw new Error(rejection);
      }
      return { ok: true } as never;
    },
    savedPlace: options.savedPlace ?? null,
    placeChanged: (place) => places.push(place),
    holdPlace: () => ({ dispose: () => undefined }),
  });
  view = created;
  created.stateChanged(state);
  if (options.isShown ?? true) {
    show();
  }
  return {
    view: created,
    sheet: asFake(created.sheet),
    side: asFake(created.sideBar),
    runs,
    scopes,
    logs,
    toasts,
    places,
    boxes: editors.boxes,
    show,
  };
}

type Setup = ReturnType<typeof inboxSetup>;

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function cards(setup: Setup): FakeElement[] {
  return findAll(setup.sheet, 'work-inbox-card');
}

function buttonNamed(root: FakeElement, label: string): FakeElement {
  const found = findAll(root, 'ui-button').find(
    (button) => button.textContent.trim() === label,
  );
  if (found === undefined) {
    throw new Error(`no button ${label}`);
  }
  return found;
}

describe('createInboxView', () => {
  beforeEach(() => {
    installFocusFakeDom(vi.stubGlobal);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('send runs work.send with the edited text and drops the edit', () => {
    const setup = inboxSetup(work([workItem('a', { draft: 'worker text' })]));
    setup.view.commands.editDraft();
    setup.boxes[0].type('my text');

    setup.view.commands.send();

    expect(setup.runs).toEqual([
      ['work.send', { itemId: 'a', text: 'my text' }],
    ]);
    expect(setup.places.at(-1)?.drafts).toEqual({});
    expect(setup.boxes[0].text).toBe('worker text');
  });

  it('blank send toasts and runs nothing', () => {
    const setup = inboxSetup(work([workItem('a')]));

    setup.view.commands.send();

    expect(setup.toasts).toEqual([['Nothing to send', 'info']]);
    expect(setup.runs).toEqual([]);
  });

  it('a sending card reads Sending…, disables Send and keeps its section', () => {
    const setup = inboxSetup(
      work([workItem('a', { draft: 'worker text', sending: 'on its way' })]),
    );
    const [card] = cards(setup);

    setup.view.commands.send();

    const send = buttonNamed(card, 'Sending…') as unknown as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(findAll(card, 'is-read-only')[0]?.textContent).toBe('on its way');
    expect(setup.boxes).toEqual([]);
    expect(setup.logs).toContain('no send for a');
    expect(setup.runs).toEqual([]);
  });

  it('a slot change keeps the focused draft box and its text', () => {
    const setup = inboxSetup(
      work([
        workItem('a', { at: '2026-11-23T11:00:00.000Z', draft: 'worker' }),
      ]),
    );
    setup.view.commands.editDraft();
    setup.boxes[0].type('mine');

    setup.view.stateChanged(
      work([
        workItem('a', { at: '2026-11-23T11:00:00.000Z', draft: 'new draft' }),
        workItem('b'),
      ]),
    );

    expect(cards(setup)).toHaveLength(2);
    expect(setup.boxes).toHaveLength(1);
    expect(setup.boxes[0]).toMatchObject({
      text: 'mine',
      isFocused: true,
      isDestroyed: false,
    });
  });

  it.each([
    {
      case: 'the Dismiss button',
      press: (setup: Setup) => buttonNamed(cards(setup)[0], 'Dismiss').click(),
      id: 'work.dismiss',
    },
    {
      case: 'd',
      press: (setup: Setup) => setup.view.commands.dismiss(),
      id: 'work.dismiss',
    },
    {
      case: 'W',
      press: (setup: Setup) => setup.view.commands.sweep(),
      id: 'work.sweep',
    },
    {
      case: 'gs',
      press: (setup: Setup) => setup.view.commands.showJobRow(),
      id: 'work.openJobRow',
    },
  ])(
    'a rejected work command logs and toasts its text: $case',
    async ({ press, id }) => {
      const setup = inboxSetup(work([workItem('a')]), {
        rejects: { [id]: 'x is not open' },
      });

      press(setup);
      await settle();

      expect(setup.runs.map(([ran]) => ran)).toEqual([id]);
      expect(setup.logs).toContain(`${id} failed: x is not open`);
      expect(setup.toasts).toEqual([['x is not open', 'error']]);
    },
  );

  it.each([
    {
      case: 'u on an open card',
      item: workItem('a'),
      section: 'needs_you',
      press: (view: InboxView) => view.commands.restore(),
      logged: 'no restore for a',
    },
    {
      case: 'z on Needs you',
      item: workItem('a'),
      section: 'needs_you',
      press: (view: InboxView) => view.commands.snooze(),
      logged: 'no snooze for a',
    },
    {
      case: 'i on an Around card',
      item: workItem('a', { section: 'around', draft: 'unused' }),
      section: 'around',
      press: (view: InboxView) => view.commands.editDraft(),
      logged: 'no editDraft for a',
    },
    {
      case: 'd on a dismissed card',
      item: workItem('a', { state: 'dismissed' }),
      section: 'all',
      press: (view: InboxView) => view.commands.dismiss(),
      logged: 'no dismiss for a',
    },
  ])(
    'a key whose action the card lacks logs and runs nothing: $case',
    async ({ item, section, press, logged }) => {
      const setup = inboxSetup(work([item]));
      setup.view.selectSection(section);

      press(setup.view);
      await settle();

      expect(setup.logs).toContain(logged);
      expect(setup.runs).toEqual([]);
    },
  );

  it("t runs the board command with the card's first ticket key", () => {
    const setup = inboxSetup(
      work([workItem('a', { ticketKeys: ['ABC-1', 'ABC-2'] })]),
    );

    setup.view.commands.ticketOnBoard();

    expect(setup.runs).toEqual([['work-board.showTicket', 'ABC-1']]);
  });

  it('openTicket toasts when the board command rejects', async () => {
    const setup = inboxSetup(work([workItem('a')]), {
      rejects: { 'work-board.showTicket': 'no command work-board.showTicket' },
    });

    setup.view.openTicket('ABC-1');
    await settle();

    expect(setup.toasts).toEqual([
      ['Board is off: switch on work-board in Settings', 'error'],
    ]);
  });

  it.each([
    {
      case: 'a done sweep with a row',
      job: { last: sweep({ rowId: 'r1' }) },
      draws: true,
    },
    {
      case: 'a running job over a done sweep with a row',
      job: {
        running: sweep({ state: 'running', rowId: 'r2' }),
        last: sweep({ rowId: 'r1' }),
      },
      draws: true,
    },
    {
      case: 'a done sweep with no row',
      job: { last: sweep({}) },
      draws: false,
    },
    {
      case: 'a running sweep and no last job',
      job: { running: sweep({ state: 'running' }) },
      draws: false,
    },
  ])(
    'Show transcript draws only while hasRow is true: $case',
    ({ job, draws }) => {
      const setup = inboxSetup(work([workItem('a')], job));

      const buttons = findAll(setup.sheet, 'ui-button').filter((button) =>
        button.textContent.includes('Show transcript'),
      );

      expect(buttons.length > 0).toBe(draws);
    },
  );

  it.each([
    {
      case: 'two open and one dismissed',
      items: [
        workItem('a'),
        workItem('b'),
        workItem('c', { state: 'dismissed' }),
      ],
      warning: ['2'],
    },
    {
      case: 'none open',
      items: [workItem('c', { state: 'dismissed' })],
      warning: [],
    },
  ])(
    'the Needs you count draws as a warning Tag while over 0: $case',
    ({ items, warning }) => {
      const setup = inboxSetup(work(items));

      expect(
        findAll(setup.side, 'ui-tag--warning').map((tag) => tag.textContent),
      ).toEqual(warning);
    },
  );

  it('first show opens Needs you on its first card and logs both lines', () => {
    const setup = inboxSetup(
      work([
        workItem('older', { at: '2026-11-23T09:00:00.000Z' }),
        workItem('newer', { at: '2026-11-23T11:00:00.000Z' }),
      ]),
      { isShown: false },
    );

    setup.show();

    expect(
      setup.logs.filter(
        (line) => line.startsWith('section ') || line.startsWith('selected '),
      ),
    ).toEqual(['section Needs you', 'selected Thread newer']);
    expect(cards(setup)[0].classList.contains('is-cursor')).toBe(true);
  });

  it('each focus change sets its scope and logs it', () => {
    const setup = inboxSetup(work([workItem('a', { draft: 'worker' })]));
    setup.scopes.length = 0;
    setup.logs.length = 0;

    setup.view.focusSideBar();
    setup.view.focusMain();
    setup.view.commands.editDraft();
    setup.view.commands.leaveBox();

    expect(setup.scopes).toEqual(['sections', 'list', 'box', 'list']);
    expect(setup.logs.filter((line) => line.endsWith(' focused'))).toEqual([
      'sections focused',
      'list focused',
      'box focused',
      'list focused',
    ]);
  });

  it('the Needs you card carries is-direct', () => {
    const setup = inboxSetup(
      work([
        workItem('direct', { at: '2026-11-23T11:00:00.000Z' }),
        workItem('around', { section: 'around' }),
      ]),
    );
    setup.view.selectSection('all');

    expect(
      cards(setup).map((card) => card.classList.contains('is-direct')),
    ).toEqual([true, false]);
  });
});
