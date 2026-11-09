import { describe, expect, it } from 'vitest';
import type {
  AgentFormChannel,
  AgentFormEnd,
  AgentFormListener,
  AgentFormMarkOptions,
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
      return {
        dispose: () => undefined,
      };
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

function fakeAlerts() {
  const counts: [string, number][] = [];
  const alerts: Alerts = {
    setOpenCount: (source, count) => counts.push([source, count]),
  };
  return { alerts, counts };
}

// Records row calls into `calls` and each mark's options into `marks`, keeps
// the close guards added, and labels the rows `labels` names.
function fakeSessions(calls: string[], labels: ReadonlyMap<string, string>) {
  const guards: {
    mayClose: (sessionId: string) => string | null;
    cancelHold?: (sessionId: string) => void;
  }[] = [];
  const marks: AgentFormMarkOptions[] = [];
  const sessions: AgentFormSessions = {
    mark: (sessionId, options) => {
      calls.push(`mark ${sessionId}`);
      marks.push(options);
    },
    activateExistingRow: (sessionId) =>
      calls.push(`activateExistingRow ${sessionId}`),
    addCloseGuard: (mayClose, cancelHold) => {
      guards.push({ mayClose, cancelHold });
      return {
        dispose: () => undefined,
      };
    },
    release: (sessionId) => calls.push(`release ${sessionId}`),
    label: (sessionId) => labels.get(sessionId) ?? null,
  };
  const refusal = (sessionId: string) =>
    guards.map((guard) => guard.mayClose(sessionId)).find((r) => r !== null) ??
    null;
  const cancelHolds = (sessionId: string) => {
    for (const guard of guards) {
      guard.cancelHold?.(sessionId);
    }
  };
  return { sessions, marks, refusal, cancelHolds };
}

function fakeListener() {
  const drafts: TestBody[] = [];
  const finishes: TestEnd[] = [];
  let cancels = 0;
  const listener: AgentFormListener<TestBody> = {
    draft: (body) => drafts.push(body),
    finish: (end) => finishes.push(end),
    cancel: () => {
      cancels++;
    },
  };
  return { listener, drafts, finishes, cancels: () => cancels };
}

function setUp(labels: ReadonlyMap<string, string> = new Map()) {
  const calls: string[] = [];
  const page = fakeChannel(calls);
  const attention = fakeAlerts();
  const logged: string[] = [];
  const tabs = fakeSessions(calls, labels);
  const presenter = createAgentFormChannelPresenter({
    channel: page.channel,
    alerts: attention.alerts,
    source: 'forms',
    noun: 'round',
    markText: (label) => `Round from ${label}`,
    markAction: 'answer',
    log: (message: string) => logged.push(message),
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
    attention,
    logged,
    marks: tabs.marks,
    refusal: tabs.refusal,
    cancelHolds: tabs.cancelHolds,
    presenter,
    openForms,
    finish,
    saveDraft,
  };
}

describe('createAgentFormChannelPresenter', () => {
  it('shows a form on the page and counts it open', () => {
    const { calls, page, attention, logged, presenter } = setUp();

    presenter.show(FORM, fakeListener().listener);

    expect(calls).toEqual(['mark app-1', 'send formShown']);
    expect(page.sent).toEqual([['formShown', FORM]]);
    expect(attention.counts).toEqual([['forms', 1]]);
    expect(logged).toEqual(['form shown: wigley-ai-gui · Pick a theme']);
  });

  it('shows a quiet form on the page and its row without a count', () => {
    const { calls, page, attention, logged, presenter } = setUp();

    presenter.quiet.show(FORM, fakeListener().listener);

    expect(calls).toEqual(['mark app-1', 'send formShown']);
    expect(page.sent).toEqual([['formShown', FORM]]);
    expect(attention.counts).toEqual([]);
    expect(logged).toEqual(['form shown: wigley-ai-gui · Pick a theme']);
  });

  it('counts only forms that are not quiet open, and a quiet form ending leaves the count', () => {
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

  it('open form refuses with its reason and closed form allows', () => {
    const { refusal, presenter, finish } = setUp();
    presenter.show(FORM, fakeListener().listener);
    presenter.show(
      { ...FORM, formId: 'form-2', sessionId: 'app-2' },
      fakeListener().listener,
    );

    expect(refusal('app-1')).toBe(
      "Finish or cancel wigley-ai-gui · Pick a theme's round first",
    );
    expect(refusal('app-3')).toBeNull();
    finish('form-1', { kind: 'cancelled', body: BODY });
    presenter.close('form-2');
    expect(refusal('app-1')).toBeNull();
    expect(refusal('app-2')).toBeNull();
  });

  const formLabelled = (label: string, sessionId: string) => ({
    ...FORM,
    formId: `form-${sessionId}`,
    sessionId,
    label,
  });
  type Presenter = ReturnType<typeof setUp>['presenter'];

  it.each([
    { case: 'nothing open', act: () => undefined, expected: null },
    {
      case: 'only a quiet form',
      act: (presenter: Presenter) =>
        presenter.quiet.show(
          formLabelled('proj · Q', 'app-q'),
          fakeListener().listener,
        ),
      expected: null,
    },
    {
      case: 'two forms',
      act: (presenter: Presenter) => {
        presenter.show(
          formLabelled('proj · A', 'app-a'),
          fakeListener().listener,
        );
        presenter.show(
          formLabelled('proj · B', 'app-b'),
          fakeListener().listener,
        );
      },
      expected: "Finish or cancel proj · A's round first",
    },
    {
      case: 'the first one closed',
      act: (presenter: Presenter) => {
        presenter.show(
          formLabelled('proj · A', 'app-a'),
          fakeListener().listener,
        );
        presenter.show(
          formLabelled('proj · B', 'app-b'),
          fakeListener().listener,
        );
        presenter.close('form-app-a');
      },
      expected: "Finish or cancel proj · B's round first",
    },
  ])(
    'mayStop names the first open form that is not quiet: $case',
    ({ act, expected }) => {
      const { presenter } = setUp();

      act(presenter);

      expect(presenter.mayStop()).toBe(expected);
    },
  );

  it('mayStop and the close guard give one wording', () => {
    const { refusal, presenter } = setUp();
    presenter.show(formLabelled('proj · A', 'app-a'), fakeListener().listener);

    expect(presenter.mayStop()).not.toBeNull();
    expect(refusal('app-a')).toBe(presenter.mayStop());
  });

  it('cancel hold cancels the sessions form and says not by finish', () => {
    const { page, logged, refusal, cancelHolds, presenter } = setUp();
    const held = fakeListener();
    const other = fakeListener();
    presenter.show(FORM, held.listener);
    presenter.show(
      { ...FORM, formId: 'form-2', sessionId: 'app-2' },
      other.listener,
    );
    logged.length = 0;

    cancelHolds('app-1');

    expect(held.cancels()).toBe(1);
    expect(other.cancels()).toBe(0);
    expect(page.sent.at(-1)).toEqual([
      'formClosed',
      { formId: 'form-1', byFinish: false },
    ]);
    expect(logged).toEqual([
      'closing the session cancels wigley-ai-gui · Pick a theme',
    ]);
    expect(refusal('app-1')).toBeNull();
    expect(refusal('app-2')).not.toBeNull();
  });

  it.each([
    { labels: new Map([['app-1', 'gamma 2']]), text: 'Round from gamma 2' },
    {
      labels: new Map<string, string>(),
      text: 'Round from wigley-ai-gui · Pick a theme',
    },
  ])('mark words the toast with the row label: $text', ({ labels, text }) => {
    const { marks, presenter } = setUp(labels);

    presenter.show(FORM, fakeListener().listener);

    expect(marks).toEqual([{ text, action: 'answer' }]);
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
      cancel: () => {},
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
    const { page, attention, refusal, presenter, openForms, finish } = setUp();
    presenter.show(FORM, {
      cancel: () => {},
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
    expect(refusal('app-1')).not.toBeNull();
  });

  it('sends the page one close, by its finish, for a form its own finish closes', () => {
    const { page, presenter, finish } = setUp();
    const end: TestEnd = { kind: 'cancelled', body: BODY };
    presenter.show(FORM, {
      cancel: () => {},
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
