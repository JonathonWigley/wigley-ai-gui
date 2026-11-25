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
import { sessionRow } from '../../sessions/contract.test-support';
import { sessionsPagePart } from '../../sessions/page/start';
import {
  type FindingOriginSpec,
  type FormsPageExports,
  formsPlaceSlot,
  type RoundPlace,
} from '../contract';
import { formsPagePart } from './start';
import { poll, pollPageKind } from './kinds/plugin-page-kind.test-support';
import { finding, presentedRound, question } from './test-rounds';

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

// A plugin's finding origin; the layer rules keep this file from the forms
// root's `SECURITY_ORIGIN`.
const SECURITY_ORIGIN: FindingOriginSpec = {
  id: 'security',
  card: 'risk',
  words: { kind: 'Risk', finding: 'Risk', proof: 'Exposure' },
  choiceNoun: 'its mitigations',
  meaning: 'a hole an attacker could use',
  minChoices: 1,
  maxChoices: 3,
  requiresSeverity: true,
  requiresProof: false,
  actions: { fix_now: 'Patch', leave_it: 'Accept' },
  chip: 'Security',
  themeToken: 'security.origin',
};

// Round `roundId` as main presents it, with three questions.
function threeQuestionForm(roundId = 'r1') {
  const round = presentedRound(roundId, {
    questions: [question('One'), question('Two'), question('Three')],
  });
  return {
    formId: round.roundId,
    sessionId: round.sessionId,
    label: round.label,
    form: round.round,
    draft: round.draft,
  };
}

type OpenForm = ReturnType<typeof openForm>;

// The forms part over sessions, main holding `open` rounds, a row for each
// round's session, the first round's selected and the page ready, so it is the
// active round. `reload` starts a new page over the same slots and readies it,
// its open rounds read landing after the page is ready, as main's answer does;
// `duringRead` runs once the new page is ready and before the read lands, handed
// the restores the new page tracked as it started and readied. `place` reads a
// round's place, r1's by default; `select` selects a round's session and lets
// the selection settle.
async function startOverOpenRounds(open: { forms: OpenForm[] }) {
  let readHeld: Promise<void> = Promise.resolve();
  const harness = startPagePart(formsPagePart, {
    parts: [sessionsPagePart],
    invoke: async (method) => {
      if (method !== 'openForms') {
        return new Promise(() => undefined);
      }
      await readHeld;
      return open.forms;
    },
    services: {
      editor: countingEditors().host,
      markdown: PLAIN_MARKDOWN,
      picker: fakeListPickerService(),
    },
  });
  const rows = harness.state.publish(sessionsRowsSlot);
  for (const { sessionId } of open.forms) {
    rows.set(sessionId, sessionRow(sessionId));
  }
  const selection = harness.state.publish(sessionsSelectionSlot);
  const select = async (formId: string) => {
    selection.set(`${formId}-session`);
    await settle();
  };
  selection.set(open.forms[0].sessionId);
  harness.ready();
  await settle();
  const reload = async (
    duringRead: (
      tracked: readonly Promise<unknown>[],
    ) => void | Promise<void> = () => undefined,
  ) => {
    const read = deferred<void>();
    readHeld = read.promise;
    const trackedBefore = harness.restores.length;
    await harness.restart();
    const tracked = harness.restores.slice(trackedBefore);
    await settle();
    await duringRead(tracked);
    read.resolve();
    await settle();
  };
  const place = (formId = 'r1') =>
    harness.state.read(formsPlaceSlot, 'test').get(formId);
  return { harness, reload, place, select };
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
  noticeLine: 0,
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

  it('stopping with one dispose throwing still releases every other part', async () => {
    const editors = countingEditors();
    let isThrowOwed = true;
    const harness = startPagePart(formsPagePart, {
      parts: [sessionsPagePart],
      anchorDispose() {
        if (isThrowOwed) {
          isThrowOwed = false;
          throw new Error('anchor gone');
        }
      },
      services: {
        editor: editors.host,
        markdown: PLAIN_MARKDOWN,
        picker: fakeListPickerService(),
      },
    });
    harness.send('formShown', openForm());
    expect(harness.anchors.length).toBeGreaterThan(0);

    await expect(harness.stop()).rejects.toThrow('anchor gone');

    expect(editors.live()).toBe(0);
    expect(harness.counts()).toEqual(noCounts);
  });

  // The stop-order ruling: the kinds and origins listeners leave before the
  // built-ins do.
  it('stop throws nothing and rebuilds nothing', async () => {
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
    const anchored = harness.anchors.length;
    const made = editors.made();
    const emitted = harness.emitted.length;

    await harness.stop();

    expect(harness.anchors.length).toBe(anchored);
    expect(editors.made()).toBe(made);
    expect(harness.emitted).toHaveLength(emitted);
  });

  // A built-in origin left registered makes the next start throw "already
  // registered".
  it('a start that throws after registering the built-in origins takes them back out', async () => {
    expect(() =>
      startPagePart(formsPagePart, {
        parts: [sessionsPagePart],
        services: { picker: fakeListPickerService() },
        layoutShow: () => {
          throw new Error('show refused');
        },
      }),
    ).toThrow('show refused');

    const harness = startPagePart(formsPagePart, {
      parts: [sessionsPagePart],
      services: { picker: fakeListPickerService() },
    });
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

  it('registerFindingOrigin_RedrawsOpenRoundsKeepingAnswers', async () => {
    const drafts: unknown[] = [];
    const editors = countingEditors();
    const harness = startPagePart(formsPagePart, {
      parts: [sessionsPagePart],
      invoke: (method, ...args) => {
        if (method === 'draft') {
          drafts.push(args);
          return Promise.resolve();
        }
        return new Promise(() => undefined);
      },
      services: {
        editor: editors.host,
        markdown: PLAIN_MARKDOWN,
        picker: fakeListPickerService(),
      },
    });
    const round = presentedRound('r1', {
      questions: [question('One')],
      findings: [finding('Two', { origin: 'security' })],
    });
    harness.send('formShown', {
      formId: round.roundId,
      sessionId: round.sessionId,
      label: round.label,
      form: round.round,
      draft: round.draft,
    });
    editors.type('typed');
    const view = harness
      .started()
      .exports?.(createRegistrations()) as FormsPageExports;
    const anchored = harness.anchors.length;

    const registration = view.registerFindingOrigin(SECURITY_ORIGIN);
    const anchoredAfterRegister = harness.anchors.length;
    registration.dispose();

    expect(anchoredAfterRegister).toBeGreaterThan(anchored);
    expect(harness.anchors.length).toBeGreaterThan(anchoredAfterRegister);
    harness.advance(formsPagePart.manifest.settings.autosaveDelayMs);
    expect(JSON.stringify(drafts.at(-1))).toContain('typed');
    await harness.stop();
  });

  it('a finish that rejects after stop draws and logs nothing', async () => {
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
    harness.ready();
    await settle();
    const { commands } = harness.started();
    commands.openReview({} as PageCommandContext);
    commands.askCancel({} as PageCommandContext);
    commands.confirmCancel({} as PageCommandContext);

    await harness.stop();
    const made = editors.made();
    const logged = harness.logs.length;
    finishing.reject(new Error('main is gone'));
    await settle();

    expect(harness.logs).toHaveLength(logged);
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

  it('the open rounds read is tracked as a restore until its rounds are back in place', async () => {
    const { harness, reload } = await startOverOpenRounds({
      forms: [threeQuestionForm()],
    });
    moveToReviewRowThree(harness);
    const emittedBefore = harness.emitted.length;
    const viewAfterReload = () =>
      dataEmitted(
        { emitted: harness.emitted.slice(emittedBefore) },
        'forms.viewChanged',
      ).at(-1);
    const settledViews: unknown[] = [];
    let tracked = 0;
    let settledDuringRead = 0;

    await reload(async (restores) => {
      tracked = restores.length;
      for (const restore of restores) {
        void restore.then(() => settledViews.push(viewAfterReload()));
      }
      await settle();
      settledDuringRead = settledViews.length;
    });

    // Sessions' own restore settles before the read lands.
    expect([
      tracked - settledDuringRead,
      settledViews.slice(settledDuringRead),
    ]).toEqual([1, [{ view: 'review', roundId: 'r1' }]]);
    await harness.stop();
  });

  it('a round the read finds in the background shows its saved view on its first activation', async () => {
    const { harness, reload, place, select } = await startOverOpenRounds({
      forms: [threeQuestionForm('r1'), threeQuestionForm('r2')],
    });
    moveToReviewRowThree(harness);

    await reload(() => select('r2'));
    await select('r1');

    expect(place('r1')).toEqual(REVIEW_ROW_THREE);
    expect(dataEmitted(harness, 'forms.viewChanged').at(-1)).toEqual({
      view: 'review',
      roundId: 'r1',
    });
    await harness.stop();
  });

  it.each([
    {
      case: 'a round closed while no page ran',
      shownDuringRead: [] as string[],
      kept: false,
    },
    {
      case: 'a round shown during the read',
      shownDuringRead: ['r2'],
      kept: true,
    },
  ])(
    'the open rounds read keeps a place only for a round it or the store holds: $case',
    async ({ shownDuringRead, kept }) => {
      const open = {
        forms: [threeQuestionForm('r1'), threeQuestionForm('r2')],
      };
      const { harness, reload, place } = await startOverOpenRounds(open);
      expect(place('r2')).toBeDefined();

      open.forms = [threeQuestionForm('r1')];
      await reload(() => {
        for (const formId of shownDuringRead) {
          harness.send('formShown', threeQuestionForm(formId));
        }
      });

      expect(place('r2') !== undefined).toBe(kept);
      await harness.stop();
    },
  );

  it.each<{
    member: string;
    add(view: FormsPageExports): void;
    taken: string;
  }>([
    {
      member: 'addCardPart',
      add: (view) =>
        view.addCardPart({
          id: PROBE_ID,
          kinds: ['question'],
          build: () => ({}),
        }),
      taken: 'is already added',
    },
    {
      member: 'addReviewColumn',
      add: (view) =>
        view.addReviewColumn({ id: PROBE_ID, title: 'Probe', cell: () => '' }),
      taken: 'is already added',
    },
    {
      member: 'registerKind',
      add: (view) => view.registerKind(pollPageKind(PROBE_ID)),
      taken: 'is already added',
    },
    {
      member: 'registerFindingOrigin',
      add: (view) => view.registerFindingOrigin(SECURITY_ORIGIN),
      taken: 'is already registered',
    },
  ])(
    "a dependent's contribution leaves when the dependent stops ($member)",
    async ({ add, taken }) => {
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
      expect(() => add(nextView)).toThrow(taken);

      dependent.dispose();

      expect(() => add(nextView)).not.toThrow();
      await harness.stop();
    },
  );

  it('toasts once when a dependent stops while the shown round holds its kind', async () => {
    const round = presentedRound('r1', {
      questions: [question('One')],
      items: { poll: [poll('P1')] },
      bodyKeys: { poll: 'poll_answers' },
    });
    const { harness } = await startOverOpenRounds({
      forms: [
        {
          formId: round.roundId,
          sessionId: round.sessionId,
          label: round.label,
          form: round.round,
          draft: round.draft,
        },
      ],
    });
    const dependent = createRegistrations();
    const view = harness.started().exports?.(dependent) as FormsPageExports;
    view.registerKind(pollPageKind('poll'));
    await settle();
    const toasts = () =>
      harness.logs
        .map((line) => line.message)
        .filter((line) => line.startsWith('toast'));

    expect(() => dependent.dispose()).not.toThrow();
    await settle();

    expect(toasts()).toEqual([
      'toast info: 1 poll item in project · r1 waits for the plugin that draws it',
    ]);
    await harness.stop();
  });

  it('logs a round holding a kind with no page kind, and toasts nothing', async () => {
    const round = presentedRound('r2', {
      questions: [question('One')],
      items: { poll: [poll('P1')], vote: [poll('V1'), poll('V2')] },
      bodyKeys: { poll: 'poll_answers', vote: 'vote_answers' },
    });
    const { harness } = await startOverOpenRounds({
      forms: [
        threeQuestionForm('r1'),
        {
          formId: round.roundId,
          sessionId: round.sessionId,
          label: round.label,
          form: round.round,
          draft: round.draft,
        },
      ],
    });
    const messages = () => harness.logs.map((line) => line.message);
    expect(messages()).toContain('form r2 holds 1 poll item with no page kind');
    expect(messages()).toContain(
      'form r2 holds 2 vote items with no page kind',
    );
    expect(messages().filter((line) => line.startsWith('toast'))).toEqual([]);
    await harness.stop();
  });
});
