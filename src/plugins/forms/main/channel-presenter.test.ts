import { describe, expect, it } from 'vitest';
import type { Alerts } from '../../../contracts/alerts';
import type { MainChannel } from '../../../contracts/plugin';
import type { SessionsMainExports } from '../../sessions/contract';
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
  sessionId: 'app-1',
  label: 'wigley-ai-gui · Pick a theme',
  round: {
    heading: 'Pick a theme',
    overview: 'Theme work; this round settles the accent.',
    questions: [],
    notices: [
      { title: 'Mocha is built in', context: 'Done.', badge: 'Applied' },
    ],
    findings: [],
  },
  draft: null,
};

const BODY: FormBody = {
  note: 'looks right',
  answers: [],
  finding_answers: [],
  notice_comments: [{ index: 1, comment: 'thanks' }],
};

type Invoke = FormsChannel['invoke'];

// Records what the presenter sends, into `calls` too, and lets the test invoke
// its handlers as the page would.
function fakeChannel(calls: string[]) {
  const handlers: Partial<Invoke> = {};
  const sent: [string, unknown][] = [];
  const channel: MainChannel<FormsChannel> = {
    handle: (method, handler) => {
      handlers[method] = handler;
    },
    send: (message, data) => {
      sent.push([message, data]);
      calls.push(`send ${message}`);
    },
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

// Records row calls into `calls` and keeps the close guards added; the
// presenter never contributes tools or connects a session.
function fakeSessions(calls: string[]) {
  const guards: ((sessionId: string) => boolean)[] = [];
  const sessions: SessionsMainExports = {
    contributeTools: () => {
      throw new Error('the presenter contributed tools');
    },
    connect: () => {
      throw new Error('the presenter connected a session');
    },
    markRound: (sessionId) => calls.push(`markRound ${sessionId}`),
    activate: (sessionId) => calls.push(`activate ${sessionId}`),
    addCloseGuard: (mayClose) => guards.push(mayClose),
  };
  const mayClose = (sessionId: string) =>
    guards.every((guard) => guard(sessionId));
  return { sessions, mayClose };
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
  const calls: string[] = [];
  const page = fakeChannel(calls);
  const window = fakeWindow();
  const attention = fakeAlerts();
  const logged: string[] = [];
  const tabs = fakeSessions(calls);
  const presenter = createChannelPresenter(
    page.channel,
    attention.alerts,
    window.window,
    (source, message) => logged.push(`[${source}] ${message}`),
    tabs.sessions,
  );
  const openRounds = () => page.invoke('openRounds') as PresentedRound[];
  const finish = (roundId: string, end: RoundEnd) =>
    page.invoke('finish', roundId, end);
  const saveDraft = (roundId: string, body: FormBody) =>
    page.invoke('draft', roundId, body);
  return {
    calls,
    page,
    window,
    attention,
    logged,
    mayClose: tabs.mayClose,
    presenter,
    openRounds,
    finish,
    saveDraft,
  };
}

describe('createChannelPresenter', () => {
  it('shows a round on the page and announces it without showing the window', () => {
    const { calls, page, window, attention, logged, presenter } = setUp();

    presenter.show(ROUND, fakeListener().listener);

    expect(calls).toEqual(['markRound app-1', 'send roundShown']);
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

  it('shows a quiet round on the page and its row without an alert or a count', () => {
    const { calls, page, attention, logged, presenter } = setUp();

    presenter.quiet.show(ROUND, fakeListener().listener);

    expect(calls).toEqual(['markRound app-1', 'send roundShown']);
    expect(page.sent).toEqual([['roundShown', ROUND]]);
    expect(attention.announced).toEqual([]);
    expect(attention.counts).toEqual([]);
    expect(logged).toEqual([
      '[forms] round shown: wigley-ai-gui · Pick a theme',
    ]);
  });

  it('counts only announced rounds open, and a quiet round ending leaves the count', () => {
    const { page, attention, presenter, openRounds, finish } = setUp();
    const quietRound = { ...ROUND, roundId: 'round-q', sessionId: 'app-q' };
    presenter.quiet.show(quietRound, fakeListener().listener);
    presenter.quiet.show(
      { ...quietRound, roundId: 'round-q2' },
      fakeListener().listener,
    );
    presenter.show(ROUND, fakeListener().listener);

    finish('round-q', { kind: 'submitted', body: BODY });
    presenter.quiet.close('round-q2');

    expect(attention.counts).toEqual([1]);
    expect(page.sent.at(-1)).toEqual(['roundClosed', 'round-q2']);
    expect(openRounds()).toEqual([ROUND]);
  });

  it("brings the window forward on the round's row when the announcement is clicked", () => {
    const { calls, window, attention, presenter } = setUp();
    presenter.show(ROUND, fakeListener().listener);
    calls.length = 0;

    attention.announced[0].onClick();

    expect(calls).toEqual(['activate app-1']);
    expect(window.shown()).toBe(1);
  });

  it("refuses to close a session's row while its round is open", () => {
    const { mayClose, presenter, finish } = setUp();
    presenter.show(ROUND, fakeListener().listener);
    presenter.show(
      { ...ROUND, roundId: 'round-2', sessionId: 'app-2' },
      fakeListener().listener,
    );

    expect(mayClose('app-1')).toBe(false);
    expect(mayClose('app-3')).toBe(true);
    finish('round-1', { kind: 'cancelled', body: BODY });
    presenter.close('round-2');
    expect(mayClose('app-1')).toBe(true);
    expect(mayClose('app-2')).toBe(true);
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
