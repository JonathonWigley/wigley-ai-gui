import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageCommandContext } from '../../../contracts/plugin';
import { PLAIN_MARKDOWN } from '../../../shared/page/markdown-mount.test-support';
import { installFakeDom } from '../../../shared/page/test-dom';
import {
  countingEditors,
  dataEmitted,
  deferred,
  noCounts,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import { createRegistrations } from '../../../shared/registrations';
import { sessionsPagePart } from '../../sessions/page/start';
import type { FormsPageExports } from '../contract';
import { formsPagePart } from './start';
import { presentedRound, question } from './test-rounds';

// Lets a settled read's `then` run.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// Round r1 as main presents it, with a question whose notes box holds an editor.
function openForm() {
  const round = presentedRound('r1', { questions: [question('One')] });
  return {
    formId: round.roundId,
    sessionId: round.sessionId,
    label: round.label,
    form: round.round,
    draft: round.draft,
  };
}

const PROBE_ID = 'probe';

describe('forms page part', () => {
  beforeEach(() => {
    installFakeDom((name, value) => vi.stubGlobal(name, value));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stops with nothing live and starts again', async () => {
    const editors = countingEditors();
    const harness = startPagePart(formsPagePart, {
      parts: [sessionsPagePart],
      services: { editor: editors.host, markdown: PLAIN_MARKDOWN },
    });
    harness.send('formShown', openForm());
    expect(editors.live()).toBeGreaterThan(0);

    await harness.stop();
    expect(harness.counts()).toEqual(noCounts);

    await harness.restart();
    await harness.stop();
  });

  it('an open-rounds read that lands after stop shows nothing', async () => {
    const read = deferred<ReturnType<typeof openForm>[]>();
    const editors = countingEditors();
    const harness = startPagePart(formsPagePart, {
      parts: [sessionsPagePart],
      invoke: () => read.promise,
      services: { editor: editors.host, markdown: PLAIN_MARKDOWN },
    });

    await harness.stop();
    read.resolve([openForm()]);
    await settle();

    expect(dataEmitted(harness, 'forms.roundShown')).toEqual([]);
  });

  it('an open-rounds read that lands before stop shows its round', async () => {
    const editors = countingEditors();
    const harness = startPagePart(formsPagePart, {
      parts: [sessionsPagePart],
      invoke: async () => [openForm()],
      services: { editor: editors.host, markdown: PLAIN_MARKDOWN },
    });

    await settle();

    expect(dataEmitted(harness, 'forms.roundShown')).toHaveLength(1);
    expect(editors.live()).toBeGreaterThan(0);
    await harness.stop();
  });

  it('a draft reply that lands after stop draws nothing', async () => {
    const saved = deferred<void>();
    const drafts: unknown[] = [];
    const editors = countingEditors();
    const harness = startPagePart(formsPagePart, {
      parts: [sessionsPagePart],
      invoke: (method, ...args) => {
        if (method === 'draft') {
          drafts.push(args);
          return saved.promise;
        }
        return new Promise(() => undefined);
      },
      services: { editor: editors.host, markdown: PLAIN_MARKDOWN },
    });
    harness.send('formShown', openForm());
    editors.type('typed');
    harness.advance(formsPagePart.manifest.settings.autosaveDelayMs);
    expect(drafts).toHaveLength(1);

    await harness.stop();
    const made = editors.made();
    const logged = harness.logs.length;
    saved.resolve();
    await settle();

    expect(editors.made()).toBe(made);
    expect(harness.logs).toHaveLength(logged);
  });

  it('a finish that rejects after stop draws nothing', async () => {
    const finishing = deferred<void>();
    const editors = countingEditors();
    const harness = startPagePart(formsPagePart, {
      parts: [sessionsPagePart],
      invoke: (method) =>
        method === 'finish' ? finishing.promise : new Promise(() => undefined),
      services: { editor: editors.host, markdown: PLAIN_MARKDOWN },
    });
    harness.send('formShown', openForm());
    harness.emit('sessions.activeChanged', { sessionId: openForm().sessionId });
    const { commands } = harness.started();
    commands.openReview({} as PageCommandContext);
    commands.askCancel({} as PageCommandContext);
    commands.confirmCancel({} as PageCommandContext);

    await harness.stop();
    const made = editors.made();
    finishing.reject(new Error('main is gone'));
    await settle();

    expect(harness.logs.map((line) => line.message)).toContainEqual(
      expect.stringContaining('not finished'),
    );
    expect(editors.made()).toBe(made);
  });

  it.each<{
    member: string;
    add(view: FormsPageExports): void;
  }>([
    {
      member: 'addCardPart',
      add: (view) =>
        view.addCardPart({
          id: PROBE_ID,
          kinds: ['question'],
          build: () => ({}),
        }),
    },
    {
      member: 'addReviewColumn',
      add: (view) =>
        view.addReviewColumn({ id: PROBE_ID, title: 'Probe', cell: () => '' }),
    },
  ])(
    "a dependent's contribution leaves when the dependent stops ($member)",
    async ({ add }) => {
      const harness = startPagePart(formsPagePart, {
        parts: [sessionsPagePart],
      });
      const started = harness.started();
      const dependent = createRegistrations();
      add(started.exports?.(dependent) as FormsPageExports);
      const nextView = started.exports?.(
        createRegistrations(),
      ) as FormsPageExports;
      expect(() => add(nextView)).toThrow('is already added');

      dependent.dispose();

      expect(() => add(nextView)).not.toThrow();
      await harness.stop();
    },
  );
});
