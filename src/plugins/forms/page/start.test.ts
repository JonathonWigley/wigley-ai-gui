import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageCommandContext } from '../../../contracts/plugin';
import { PLAIN_MARKDOWN } from '../../../shared/page/markdown-mount.test-support';
import { fakeListPickerService } from '../../../shared/page/fake-list-picker-service.test-support';
import { installFakeDom } from '../../../shared/page/test-dom';
import {
  countingEditors,
  dataEmitted,
  deferred,
  noCounts,
  startPagePart,
} from '../../../shared/plugin-part-harness.test-support';
import { createRegistrations } from '../../../shared/registrations';
import {
  sessionsRowsSlot,
  sessionsSelectionSlot,
} from '../../sessions/contract';
import { sessionRow } from '../../sessions/page/session-fakes';
import { sessionsPagePart } from '../../sessions/page/start';
import {
  type FormsPageExports,
  formsPlaceSlot,
  type RoundPlace,
} from '../contract';
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

// Round r1 as main presents it, with three questions.
function threeQuestionForm() {
  const round = presentedRound('r1', {
    questions: [question('One'), question('Two'), question('Three')],
  });
  return { ...openForm(), form: round.round };
}

// The forms part over sessions, main holding `open` rounds, r1's session's row
// selected and the page ready, so r1 is the active round. `reload` starts a new
// page over the same slots and readies it; `beforeRead` runs once the new page
// has started, before its open rounds read lands. `place` reads r1's place.
async function startOverOpenRounds(open: { forms: unknown[] }) {
  const harness = startPagePart(formsPagePart, {
    parts: [sessionsPagePart],
    invoke: async (method) =>
      method === 'openForms' ? open.forms : new Promise(() => undefined),
    services: {
      editor: countingEditors().host,
      markdown: PLAIN_MARKDOWN,
      picker: fakeListPickerService(),
    },
  });
  const { sessionId } = openForm();
  harness.state.publish(sessionsRowsSlot).set(sessionId, sessionRow(sessionId));
  harness.state.publish(sessionsSelectionSlot).set(sessionId);
  harness.emit('core.pageReady', null);
  await settle();
  const reload = async (beforeRead: () => void = () => undefined) => {
    await harness.restart();
    beforeRead();
    harness.emit('core.pageReady', null);
    await settle();
  };
  const place = () => harness.state.read(formsPlaceSlot, 'test').get('r1');
  return { harness, reload, place };
}

const NO_CONTEXT = {} as PageCommandContext;

// Moves r1 to item 2, then to the review's row 3.
function moveToReviewRowThree(
  harness: Awaited<ReturnType<typeof startOverOpenRounds>>['harness'],
) {
  const { commands } = harness.started();
  commands.nextItem(NO_CONTEXT);
  commands.openReview(NO_CONTEXT);
  commands.reviewNext(NO_CONTEXT);
  commands.reviewNext(NO_CONTEXT);
}

const REVIEW_ROW_THREE: RoundPlace = {
  focus: 1,
  reviewRow: 2,
  view: 'review',
  confirmReturnView: 'review',
};

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
      services: {
        editor: editors.host,
        markdown: PLAIN_MARKDOWN,
        picker: fakeListPickerService(),
      },
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
      services: {
        editor: editors.host,
        markdown: PLAIN_MARKDOWN,
        picker: fakeListPickerService(),
      },
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
      services: {
        editor: editors.host,
        markdown: PLAIN_MARKDOWN,
        picker: fakeListPickerService(),
      },
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
      services: {
        editor: editors.host,
        markdown: PLAIN_MARKDOWN,
        picker: fakeListPickerService(),
      },
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
      services: {
        editor: editors.host,
        markdown: PLAIN_MARKDOWN,
        picker: fakeListPickerService(),
      },
    });
    harness.send('formShown', openForm());
    const { sessionId } = openForm();
    harness.state
      .publish(sessionsRowsSlot)
      .set(sessionId, sessionRow(sessionId));
    harness.state.publish(sessionsSelectionSlot).set(sessionId);
    harness.emit('core.pageReady', null);
    await settle();
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

  it('reload_restores_focus_review_row_and_view', async () => {
    const { harness, reload, place } = await startOverOpenRounds({
      forms: [threeQuestionForm()],
    });
    moveToReviewRowThree(harness);
    expect(place()).toEqual(REVIEW_ROW_THREE);

    await reload();

    expect(place()).toEqual(REVIEW_ROW_THREE);
    expect(dataEmitted(harness, 'forms.viewChanged').at(-1)).toEqual({
      view: 'review',
      roundId: 'r1',
    });
    await harness.stop();
  });

  it('saved_place_survives_the_first_form_shown_write', async () => {
    const { harness, reload, place } = await startOverOpenRounds({
      forms: [threeQuestionForm()],
    });
    moveToReviewRowThree(harness);

    await reload(() => harness.send('formShown', threeQuestionForm()));

    expect(place()).toEqual(REVIEW_ROW_THREE);
    await harness.stop();
  });

  it('form_closed_deletes_its_place', async () => {
    const { harness, place } = await startOverOpenRounds({
      forms: [threeQuestionForm()],
    });
    expect(place()).toBeDefined();

    harness.send('formClosed', { formId: 'r1', byFinish: false });

    expect(place()).toBeUndefined();
    await harness.stop();
  });

  it('closed_while_no_page_ran_is_pruned', async () => {
    const open = { forms: [threeQuestionForm()] };
    const { harness, reload, place } = await startOverOpenRounds(open);
    expect(place()).toBeDefined();

    open.forms = [];
    await reload();

    expect(place()).toBeUndefined();
    await harness.stop();
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
        services: { picker: fakeListPickerService() },
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
