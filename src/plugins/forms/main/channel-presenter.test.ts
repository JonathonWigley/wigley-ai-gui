import { describe, expect, it } from 'vitest';
import type { Alerts } from '../../../contracts/alerts';
import type { MainChannel } from '../../../contracts/plugin';
import type {
  FormBody,
  FormsChannel,
  PresentedRound,
  RoundEnd,
  RoundListener,
} from '../contract';
import { createChannelPresenter } from './channel-presenter';

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

type Invoke = FormsChannel['invoke'];

// Records what the presenter sends and lets the test invoke its handlers as
// the page would.
function fakeChannel() {
  const handlers: Partial<Invoke> = {};
  const sent: [string, unknown][] = [];
  const channel: MainChannel<FormsChannel> = {
    handle: (method, handler) => {
      handlers[method] = handler;
    },
    send: (message, data) => sent.push([message, data]),
  };
  const invoke = <K extends keyof Invoke>(
    method: K,
    ...args: Parameters<Invoke[K]>
  ) => (handlers[method] as (...args: unknown[]) => unknown)(...args);
  return { channel, sent, invoke };
}

function fakeWindow() {
  let shown = 0;
  const window = {
    show: () => {
      shown++;
    },
  };
  return { window, shown: () => shown };
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
  const page = fakeChannel();
  const window = fakeWindow();
  const attention = fakeAlerts();
  const logged: string[] = [];
  const presenter = createChannelPresenter(
    page.channel,
    attention.alerts,
    window.window,
    (source, message) => logged.push(`[${source}] ${message}`),
  );
  const openRounds = () => page.invoke('openRounds') as PresentedRound[];
  const finish = (roundId: string, end: RoundEnd) =>
    page.invoke('finish', roundId, end);
  const saveDraft = (roundId: string, body: FormBody) =>
    page.invoke('draft', roundId, body);
  return {
    page,
    window,
    attention,
    logged,
    presenter,
    openRounds,
    finish,
    saveDraft,
  };
}

describe('createChannelPresenter', () => {
  it('shows a round on the page and announces it without showing the window', () => {
    const { page, window, attention, logged, presenter } = setUp();

    presenter.show(ROUND, fakeListener().listener);

    expect(page.sent).toEqual([['roundShown', ROUND]]);
    expect(attention.announced.map(({ title, body }) => [title, body])).toEqual(
      [['New review round', 'wigley-ai-gui · Pick a theme']],
    );
    expect(attention.counts).toEqual([1]);
    expect(logged).toEqual([
      '[forms] round shown: wigley-ai-gui · Pick a theme',
    ]);
    expect(window.shown()).toBe(0);
  });

  it('brings the window forward on the round when the announcement is clicked', () => {
    const { page, window, attention, presenter } = setUp();
    presenter.show(ROUND, fakeListener().listener);

    attention.announced[0].onClick();

    expect(window.shown()).toBe(1);
    expect(page.sent.at(-1)).toEqual(['focusRound', 'round-1']);
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
    const { attention, presenter, openRounds, finish, saveDraft } = setUp();
    const { listener, drafts, finishes } = fakeListener();
    presenter.show(ROUND, listener);
    const end: RoundEnd = { kind: 'submitted', body: BODY };

    finish('round-1', end);
    saveDraft('round-1', BODY);
    finish('round-1', end);

    expect(finishes).toEqual([end]);
    expect(drafts).toEqual([]);
    expect(openRounds()).toEqual([]);
    expect(attention.counts).toEqual([1, 0]);
  });

  it('sends no close to the page for a round its own finish closes', () => {
    const { page, presenter, finish } = setUp();
    const end: RoundEnd = { kind: 'cancelled', body: BODY };
    presenter.show(ROUND, {
      draft: () => {},
      finish: () => presenter.close('round-1'),
    });

    finish('round-1', end);

    expect(page.sent).toEqual([['roundShown', ROUND]]);
  });

  it('closes an open round on the page, and ignores a round already gone', () => {
    const { page, attention, presenter, openRounds } = setUp();
    presenter.show(ROUND, fakeListener().listener);

    presenter.close('round-1');
    presenter.close('round-1');

    expect(page.sent.slice(1)).toEqual([['roundClosed', 'round-1']]);
    expect(attention.counts).toEqual([1, 0]);
    expect(openRounds()).toEqual([]);
  });
});
