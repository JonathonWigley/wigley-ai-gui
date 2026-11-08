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
import {
  sessionsRowsSlot,
  sessionsSelectionSlot,
} from '../../sessions/contract';
import { sessionRow } from '../../sessions/contract.test-support';
import { sessionsPagePart } from '../../sessions/page/start';
import {
  type PresentedPrimer,
  type PrimerPlace,
  primerPlaceSlot,
} from '../contract';
import { primerPagePart } from './start';
import { presentedPrimer } from './test-primers';

// Lets a settled read's `then` run.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// The primer part over sessions, main holding `open` primers, a row for each
// primer's session, the first one's selected and the page ready, so it is the
// active primer. `reload` starts a new page over the same slots and readies it;
// `beforeRead` runs once the new page has started, before its open primers read
// lands. `place` reads p1's place; `select` selects a primer's session and lets
// the selection settle.
async function startOverOpenPrimers(open: { forms: PresentedPrimer[] }) {
  const harness = startPagePart(primerPagePart, {
    parts: [sessionsPagePart],
    invoke: async (method) =>
      method === 'openForms' ? open.forms : new Promise(() => undefined),
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
  const select = async (primerId: string) => {
    selection.set(presentedPrimer(primerId).sessionId);
    await settle();
  };
  selection.set(open.forms[0].sessionId);
  harness.emit('core.pageReady', null);
  await settle();
  const reload = async (beforeRead: () => void = () => undefined) => {
    await harness.restart();
    beforeRead();
    harness.emit('core.pageReady', null);
    await settle();
  };
  const place = () => harness.state.read(primerPlaceSlot, 'test').get('p1');
  return { harness, open, reload, place, select };
}

// Task 1's first item selected, under the review's Cancel prompt.
const CANCEL_PROMPT_ON_TASK_ONE: PrimerPlace = {
  selectedTask: { kind: 'task', entryId: '1' },
  selectedItem: 1,
  pane: 'tasks',
  cardColumn: 'tasks',
  view: 'confirm',
  confirmReturnView: 'review',
};

describe('primer page part', () => {
  beforeEach(() => {
    installFakeDom((name, value) => vi.stubGlobal(name, value));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each<{
    case: string;
    act(setup: Awaited<ReturnType<typeof startOverOpenPrimers>>): Promise<void>;
    expected: PrimerPlace | undefined;
  }>([
    {
      case: 'reload_restores_task_item_pane_and_view',
      act: ({ reload }) => reload(),
      expected: CANCEL_PROMPT_ON_TASK_ONE,
    },
    {
      case: 'saved_place_survives_the_first_form_shown_write',
      act: ({ reload, harness }) =>
        reload(() => harness.send('formShown', presentedPrimer('p1'))),
      expected: CANCEL_PROMPT_ON_TASK_ONE,
    },
    {
      case: 'background_primer_place_carries_the_primer_view',
      act: ({ select }) => select('p2'),
      expected: { ...CANCEL_PROMPT_ON_TASK_ONE, view: 'primer' },
    },
    {
      case: 'form_closed_deletes_its_place',
      act: async ({ harness }) =>
        harness.send('formClosed', { formId: 'p1', byFinish: false }),
      expected: undefined,
    },
    {
      case: 'closed_while_no_page_ran_is_pruned',
      act: async ({ open, reload }) => {
        open.forms = [];
        await reload();
      },
      expected: undefined,
    },
  ])('primer place: $case', async ({ act, expected }) => {
    const setup = await startOverOpenPrimers({
      forms: [presentedPrimer('p1'), presentedPrimer('p2')],
    });
    const { commands } = setup.harness.started();
    commands.nextRow({} as PageCommandContext);
    commands.openReview({} as PageCommandContext);
    commands.askCancel({} as PageCommandContext);
    expect(setup.place()).toEqual(CANCEL_PROMPT_ON_TASK_ONE);

    await act(setup);

    expect(setup.place()).toEqual(expected);
    await setup.harness.stop();
  });

  it('stops with nothing live and starts again', async () => {
    const editors = countingEditors();
    const harness = startPagePart(primerPagePart, {
      parts: [sessionsPagePart],
      services: {
        editor: editors.host,
        markdown: PLAIN_MARKDOWN,
        picker: fakeListPickerService(),
      },
    });
    harness.send('formShown', presentedPrimer('p1'));
    expect(editors.live()).toBeGreaterThan(0);

    await harness.stop();
    expect(harness.counts()).toEqual(noCounts);

    await harness.restart();
    await harness.stop();
  });

  it('an open-primers read that lands after stop shows nothing', async () => {
    const read = deferred<PresentedPrimer[]>();
    const editors = countingEditors();
    const harness = startPagePart(primerPagePart, {
      parts: [sessionsPagePart],
      invoke: () => read.promise,
      services: {
        editor: editors.host,
        markdown: PLAIN_MARKDOWN,
        picker: fakeListPickerService(),
      },
    });

    await harness.stop();
    read.resolve([presentedPrimer('p1')]);
    await settle();

    expect(dataEmitted(harness, 'primer.primerShown')).toEqual([]);
  });

  it('a draft reply that lands after stop draws nothing', async () => {
    const saved = deferred<void>();
    const drafts: unknown[] = [];
    const editors = countingEditors();
    const harness = startPagePart(primerPagePart, {
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
    harness.send('formShown', presentedPrimer('p1'));
    editors.type('typed');
    harness.advance(primerPagePart.manifest.settings.autosaveDelayMs);
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
    const harness = startPagePart(primerPagePart, {
      parts: [sessionsPagePart],
      invoke: (method) =>
        method === 'finish' ? finishing.promise : new Promise(() => undefined),
      services: {
        editor: editors.host,
        markdown: PLAIN_MARKDOWN,
        picker: fakeListPickerService(),
      },
    });
    const primer = presentedPrimer('p1');
    harness.send('formShown', primer);
    harness.state
      .publish(sessionsRowsSlot)
      .set(primer.sessionId, sessionRow(primer.sessionId));
    harness.state.publish(sessionsSelectionSlot).set(primer.sessionId);
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

  it('an open-primers read that lands before stop shows its primer', async () => {
    const editors = countingEditors();
    const harness = startPagePart(primerPagePart, {
      parts: [sessionsPagePart],
      invoke: async () => [presentedPrimer('p1')],
      services: {
        editor: editors.host,
        markdown: PLAIN_MARKDOWN,
        picker: fakeListPickerService(),
      },
    });

    await settle();

    expect(dataEmitted(harness, 'primer.primerShown')).toHaveLength(1);
    expect(editors.live()).toBeGreaterThan(0);
    await harness.stop();
  });
});
