import type { BrowserWindow } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Alerts } from '../contracts/alerts';
import { BRIDGE_CHANNELS } from '../contracts/bridge';
import type {
  FormBody,
  PresentedRound,
  RoundEnd,
  RoundListener,
} from '../contracts/forms';
import { createWindowPresenter } from './window-presenter';

type Handler = (event: object, ...args: unknown[]) => unknown;

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  listeners: new Map<string, Handler>(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) =>
      ipc.handlers.set(channel, handler),
    on: (channel: string, listener: Handler) =>
      ipc.listeners.set(channel, listener),
  },
}));

const ROUND: PresentedRound = {
  roundId: 'round-1',
  label: 'wigley-ai-gui · Pick a theme',
  round: {
    heading: 'Pick a theme',
    overview: 'Theme work; this round settles the accent.',
    questions: [],
    notices: [
      { title: 'Mocha is built in', context: 'Done.', badge: 'Applied' },
    ],
  },
  draft: null,
};

const BODY: FormBody = {
  note: 'looks right',
  answers: [],
  notice_comments: [{ index: 1, comment: 'thanks' }],
};

function fakeWindow() {
  const sent: [string, unknown][] = [];
  let shown = 0;
  let focused = 0;
  const window = {
    show: () => {
      shown++;
    },
    focus: () => {
      focused++;
    },
    webContents: {
      send: (channel: string, value: unknown) => sent.push([channel, value]),
    },
  } as unknown as BrowserWindow;
  return { window, sent, shown: () => shown, focused: () => focused };
}

function fakeAlerts() {
  const announced: { title: string; body: string; onClick: () => void }[] = [];
  const counts: number[] = [];
  const alerts: Alerts = {
    announce: (title, body, onClick) =>
      announced.push({ title, body, onClick }),
    setOpenCount: (count) => counts.push(count),
  };
  return { alerts, announced, counts };
}

function fakeListener() {
  const drafts: FormBody[] = [];
  const finishes: RoundEnd[] = [];
  const listener: RoundListener = {
    draft: (body) => drafts.push(body),
    finish: (end) => finishes.push(end),
  };
  return { listener, drafts, finishes };
}

function setUp() {
  const page = fakeWindow();
  const attention = fakeAlerts();
  const logged: string[] = [];
  const presenter = createWindowPresenter(
    page.window,
    attention.alerts,
    (source, message) => logged.push(`[${source}] ${message}`),
  );
  const openRounds = () =>
    ipc.handlers.get(BRIDGE_CHANNELS.openRounds)?.({}) as PresentedRound[];
  const fromPage = (channel: string, ...args: unknown[]) =>
    ipc.listeners.get(channel)?.({}, ...args);
  const saveDraft = (roundId: string, body: FormBody) =>
    ipc.handlers.get(BRIDGE_CHANNELS.draft)?.({}, roundId, body);
  return {
    page,
    attention,
    logged,
    presenter,
    openRounds,
    fromPage,
    saveDraft,
  };
}

beforeEach(() => {
  ipc.handlers.clear();
  ipc.listeners.clear();
});

describe('createWindowPresenter', () => {
  it('shows a round on the page and announces it without showing the window', () => {
    const { page, attention, logged, presenter } = setUp();

    presenter.show(ROUND, fakeListener().listener);

    expect(page.sent).toEqual([[BRIDGE_CHANNELS.roundShown, ROUND]]);
    expect(attention.announced.map(({ title, body }) => [title, body])).toEqual(
      [['New review round', 'wigley-ai-gui · Pick a theme']],
    );
    expect(attention.counts).toEqual([1]);
    expect(logged).toEqual([
      '[forms] round shown: wigley-ai-gui · Pick a theme',
    ]);
    expect(page.shown()).toBe(0);
  });

  it('brings the window forward on the round when the announcement is clicked', () => {
    const { page, attention, presenter } = setUp();
    presenter.show(ROUND, fakeListener().listener);

    attention.announced[0].onClick();

    expect(page.shown()).toBe(1);
    expect(page.focused()).toBe(1);
    expect(page.sent.at(-1)).toEqual([BRIDGE_CHANNELS.focusRound, 'round-1']);
  });

  it('serves open rounds with their latest draft and passes drafts on', () => {
    const { presenter, openRounds, saveDraft } = setUp();
    const { listener, drafts } = fakeListener();
    presenter.show(ROUND, listener);

    saveDraft('round-1', BODY);

    expect(drafts).toEqual([BODY]);
    expect(openRounds()).toEqual([{ ...ROUND, draft: BODY }]);
  });

  it("throws a draft's failed save out of the handler, so the page's invoke rejects", () => {
    const { presenter, saveDraft } = setUp();
    presenter.show(ROUND, {
      draft: () => {
        throw new Error('could not save round round-1: EACCES');
      },
      finish: () => {},
    });

    expect(() => saveDraft('round-1', BODY)).toThrow(
      'could not save round round-1: EACCES',
    );
  });

  it('answers a draft for a round no longer open without passing it on', () => {
    const { saveDraft } = setUp();

    expect(saveDraft('round-gone', BODY)).toBeUndefined();
  });

  it('ends a round the page finishes and drops what arrives after', () => {
    const { attention, presenter, openRounds, fromPage, saveDraft } = setUp();
    const { listener, drafts, finishes } = fakeListener();
    presenter.show(ROUND, listener);
    const end: RoundEnd = { kind: 'submitted', body: BODY };

    fromPage(BRIDGE_CHANNELS.finish, 'round-1', end);
    saveDraft('round-1', BODY);
    fromPage(BRIDGE_CHANNELS.finish, 'round-1', end);

    expect(finishes).toEqual([end]);
    expect(drafts).toEqual([]);
    expect(openRounds()).toEqual([]);
    expect(attention.counts).toEqual([1, 0]);
  });

  it('sends no close to the page for a round its own finish closes', () => {
    const { page, presenter, fromPage } = setUp();
    const end: RoundEnd = { kind: 'cancelled', body: BODY };
    presenter.show(ROUND, {
      draft: () => {},
      finish: () => presenter.close('round-1'),
    });

    fromPage(BRIDGE_CHANNELS.finish, 'round-1', end);

    expect(page.sent).toEqual([[BRIDGE_CHANNELS.roundShown, ROUND]]);
  });

  it('closes an open round on the page, and ignores a round already gone', () => {
    const { page, attention, presenter, openRounds } = setUp();
    presenter.show(ROUND, fakeListener().listener);

    presenter.close('round-1');
    presenter.close('round-1');

    expect(page.sent.slice(1)).toEqual([
      [BRIDGE_CHANNELS.roundClosed, 'round-1'],
    ]);
    expect(attention.counts).toEqual([1, 0]);
    expect(openRounds()).toEqual([]);
  });
});
