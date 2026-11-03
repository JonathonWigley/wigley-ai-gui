import { describe, expect, it } from 'vitest';
import type {
  AgentFormChannel,
  AgentFormEnd,
  AgentFormListener,
  AgentFormSessions,
  PresentedAgentForm,
} from '../../contracts/agent-forms';
import type { Alerts } from '../../contracts/alerts';
import type { MainChannel } from '../../contracts/plugin';
import { createAgentFormChannelPresenter } from './channel-presenter';
import type { TestBody, TestForm } from './test-form-type';

type TestChannel = AgentFormChannel<TestForm, TestBody>;
type TestEnd = AgentFormEnd<TestBody>;

const FORM: PresentedAgentForm<TestForm, TestBody> = {
  formId: 'form-1',
  sessionId: 'app-1',
  label: 'wigley-ai-gui · Pick a theme',
  form: { heading: 'Pick a theme', items: ['Mocha is built in'] },
  draft: null,
};

const BODY: TestBody = { note: 'looks right' };

type Invoke = TestChannel['invoke'];

// Records what the presenter sends, into `calls` too, and lets the test invoke
// its handlers as the page would.
function fakeChannel(calls: string[]) {
  const handlers: Partial<Invoke> = {};
  const sent: [string, unknown][] = [];
  const channel: MainChannel<TestChannel> = {
    handle: (method, handler) => {
      handlers[method] = handler;
      return { dispose: () => {} };
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
  const counts: [string, number][] = [];
  const alerts: Alerts = {
    announce: (title, body, onClick) =>
      announced.push({ title, body, onClick }),
    setOpenCount: (source, count) => counts.push([source, count]),
  };
  return { alerts, announced, counts };
}

// Records row calls into `calls` and keeps the close guards added.
function fakeSessions(calls: string[]) {
  const guards: ((sessionId: string) => boolean)[] = [];
  const sessions: AgentFormSessions = {
    mark: (sessionId) => calls.push(`mark ${sessionId}`),
    activateExistingRow: (sessionId) =>
      calls.push(`activateExistingRow ${sessionId}`),
    addCloseGuard: (mayClose) => guards.push(mayClose),
    release: (sessionId) => calls.push(`release ${sessionId}`),
  };
  const mayClose = (sessionId: string) =>
    guards.every((guard) => guard(sessionId));
  return { sessions, mayClose };
}

function fakeListener() {
  const drafts: TestBody[] = [];
  const finishes: TestEnd[] = [];
  const listener: AgentFormListener<TestBody> = {
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
  const presenter = createAgentFormChannelPresenter({
    channel: page.channel,
    alerts: attention.alerts,
    source: 'forms',
    announceTitle: 'New review round',
    window: window.window,
    log: (source, message) => logged.push(`[${source}] ${message}`),
    sessions: tabs.sessions,
  });
  const openForms = () =>
    page.invoke('openForms') as PresentedAgentForm<TestForm, TestBody>[];
  const finish = (formId: string, end: TestEnd) =>
    page.invoke('finish', formId, end);
  const saveDraft = (formId: string, body: TestBody) =>
    page.invoke('draft', formId, body);
  return {
    calls,
    page,
    window,
    attention,
    logged,
    mayClose: tabs.mayClose,
    presenter,
    openForms,
    finish,
    saveDraft,
  };
}

describe('createAgentFormChannelPresenter', () => {
  it('shows a form on the page and announces it without showing the window', () => {
    const { calls, page, window, attention, logged, presenter } = setUp();

    presenter.show(FORM, fakeListener().listener);

    expect(calls).toEqual(['mark app-1', 'send formShown']);
    expect(page.sent).toEqual([['formShown', FORM]]);
    expect(attention.announced.map(({ title, body }) => [title, body])).toEqual(
      [[expect.any(String), 'wigley-ai-gui · Pick a theme']],
    );
    expect(attention.counts).toEqual([['forms', 1]]);
    expect(logged).toEqual([
      '[forms] form shown: wigley-ai-gui · Pick a theme',
    ]);
    expect(window.shown()).toBe(0);
  });

  it('shows a quiet form on the page and its row without an alert or a count', () => {
    const { calls, page, attention, logged, presenter } = setUp();

    presenter.quiet.show(FORM, fakeListener().listener);

    expect(calls).toEqual(['mark app-1', 'send formShown']);
    expect(page.sent).toEqual([['formShown', FORM]]);
    expect(attention.announced).toEqual([]);
    expect(attention.counts).toEqual([]);
    expect(logged).toEqual([
      '[forms] form shown: wigley-ai-gui · Pick a theme',
    ]);
  });

  it('counts only announced forms open, and a quiet form ending leaves the count', () => {
    const { page, attention, presenter, openForms, finish } = setUp();
    const quietForm = { ...FORM, formId: 'form-q', sessionId: 'app-q' };
    presenter.quiet.show(quietForm, fakeListener().listener);
    presenter.quiet.show(
      { ...quietForm, formId: 'form-q2' },
      fakeListener().listener,
    );
    presenter.show(FORM, fakeListener().listener);

    finish('form-q', { kind: 'submitted', body: BODY });
    presenter.quiet.close('form-q2');

    expect(attention.counts).toEqual([['forms', 1]]);
    expect(page.sent.at(-1)).toEqual([
      'formClosed',
      { formId: 'form-q2', byFinish: false },
    ]);
    expect(openForms()).toEqual([FORM]);
  });

  it("brings the window forward on the form's row when the announcement is clicked", () => {
    const { calls, window, attention, presenter } = setUp();
    presenter.show(FORM, fakeListener().listener);
    calls.length = 0;

    attention.announced[0].onClick();

    expect(calls).toEqual(['activateExistingRow app-1']);
    expect(window.shown()).toBe(1);
  });

  it("refuses to close a session's row while its form is open", () => {
    const { mayClose, presenter, finish } = setUp();
    presenter.show(FORM, fakeListener().listener);
    presenter.show(
      { ...FORM, formId: 'form-2', sessionId: 'app-2' },
      fakeListener().listener,
    );

    expect(mayClose('app-1')).toBe(false);
    expect(mayClose('app-3')).toBe(true);
    finish('form-1', { kind: 'cancelled', body: BODY });
    presenter.close('form-2');
    expect(mayClose('app-1')).toBe(true);
    expect(mayClose('app-2')).toBe(true);
  });

  it('serves open forms with their latest draft and passes drafts on', () => {
    const { presenter, openForms, saveDraft } = setUp();
    const { listener, drafts } = fakeListener();
    presenter.show(FORM, listener);

    saveDraft('form-1', BODY);

    expect(drafts).toEqual([BODY]);
    expect(openForms()).toEqual([{ ...FORM, draft: BODY }]);
  });

  it("throws a draft's failed save out of the handler, so the page's invoke rejects", () => {
    const { presenter, saveDraft } = setUp();
    presenter.show(FORM, {
      draft: () => {
        throw new Error('could not save form form-1: EACCES');
      },
      finish: () => {},
    });

    expect(() => saveDraft('form-1', BODY)).toThrow(
      'could not save form form-1: EACCES',
    );
  });

  it('answers a draft for a form no longer open without passing it on', () => {
    const { saveDraft } = setUp();

    expect(saveDraft('form-gone', BODY)).toBeUndefined();
  });

  it('ends a form the page finishes and drops what arrives after', () => {
    const { calls, page, attention, presenter, openForms, finish, saveDraft } =
      setUp();
    const { listener, drafts, finishes } = fakeListener();
    presenter.show(FORM, listener);
    const end: TestEnd = { kind: 'submitted', body: BODY };
    calls.length = 0;

    finish('form-1', end);
    saveDraft('form-1', BODY);
    finish('form-1', end);

    expect(finishes).toEqual([end]);
    expect(calls).toEqual(['send formClosed', 'release app-1']);
    expect(drafts).toEqual([]);
    expect(openForms()).toEqual([]);
    expect(attention.counts).toEqual([
      ['forms', 1],
      ['forms', 0],
    ]);
    expect(page.sent.at(-1)).toEqual([
      'formClosed',
      { formId: 'form-1', byFinish: true },
    ]);
  });

  it("keeps a form open and rejects the page's finish when its listener throws", () => {
    const { page, attention, mayClose, presenter, openForms, finish } = setUp();
    presenter.show(FORM, {
      draft: () => {},
      finish: () => {
        throw new Error('form form-1 has no item 3');
      },
    });

    expect(() => finish('form-1', { kind: 'submitted', body: BODY })).toThrow(
      'form form-1 has no item 3',
    );
    expect(openForms()).toEqual([FORM]);
    expect(page.sent).toEqual([['formShown', FORM]]);
    expect(attention.counts).toEqual([['forms', 1]]);
    expect(mayClose('app-1')).toBe(false);
  });

  it('sends the page one close, by its finish, for a form its own finish closes', () => {
    const { page, presenter, finish } = setUp();
    const end: TestEnd = { kind: 'cancelled', body: BODY };
    presenter.show(FORM, {
      draft: () => {},
      finish: () => presenter.close('form-1'),
    });

    finish('form-1', end);

    expect(page.sent).toEqual([
      ['formShown', FORM],
      ['formClosed', { formId: 'form-1', byFinish: true }],
    ]);
  });

  it('closes an open form on the page, not by its finish, and ignores a form already gone', () => {
    const { calls, page, attention, presenter, openForms } = setUp();
    presenter.show(FORM, fakeListener().listener);
    calls.length = 0;

    presenter.close('form-1');
    presenter.close('form-1');

    expect(calls).toEqual(['send formClosed', 'release app-1']);
    expect(page.sent.slice(1)).toEqual([
      ['formClosed', { formId: 'form-1', byFinish: false }],
    ]);
    expect(attention.counts).toEqual([
      ['forms', 1],
      ['forms', 0],
    ]);
    expect(openForms()).toEqual([]);
  });
});
