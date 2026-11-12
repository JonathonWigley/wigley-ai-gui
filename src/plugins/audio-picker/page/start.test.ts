import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorEvents, EditorHost } from '../../../contracts/editor';
import type { PageCommandContext } from '../../../contracts/plugin';
import { fakeListPickerService } from '../../../shared/page/fake-list-picker-service.test-support';
import { PLAIN_MARKDOWN } from '../../../shared/page/markdown-mount.test-support';
import { installFakeDom } from '../../../shared/page/test-dom';
import {
  countingEditors,
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
  type AudioPickerPageExports,
  type AudioPickerPlace,
  audioPickerPlaceSlot,
  type PresentedAudioPicker,
} from '../contract';
import type { AudioOutput, DecodedAudio, Playing } from './audio/audio-output';
import { VISIBILITY_POLL_MS } from './picker-audio';
import { audioPickerPagePart, createAudioPickerPagePart } from './start';
import { presentedPicker, soundsPicker, twoMomentPicker } from './test-pickers';

// Lets a settled read's `then` run.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// Every session the harness holds a row for.
const SESSION_IDS = ['p1-session', 'p2-session', 'other-session'];

// One sound the fake output played, and how many times it was stopped.
interface FakePlay {
  stops: number;
}

// Outputs that decode any bytes to a 2-second sound and record every play in
// `plays`; `outputs` holds one entry per output made, as each start of the
// part makes one, and whether it was disposed.
function fakeOutputs() {
  const plays: FakePlay[] = [];
  const outputs: { isDisposed: boolean }[] = [];
  const make = (): AudioOutput => {
    const made = { isDisposed: false };
    outputs.push(made);
    return {
      decode: async (): Promise<DecodedAudio> => ({
        duration: 2,
        channels: [new Float32Array([0.5, -0.25])],
        byteSize: 8,
      }),
      play: (): Playing => {
        const play: FakePlay = { stops: 0 };
        plays.push(play);
        const ended = deferred<void>();
        return {
          stop: () => {
            play.stops += 1;
            ended.resolve();
          },
          ended: ended.promise,
        };
      },
      dispose: () => {
        made.isDisposed = true;
      },
    };
  };
  return { make, plays, outputs };
}

// The counting editor host, with the events of every editor it made in
// `events`, so a test can focus or blur a box as the user's click does.
function recordingEditors() {
  const counting = countingEditors();
  const events: EditorEvents[] = [];
  const host: EditorHost = {
    ...counting.host,
    create: (parent, doc, made) => {
      events.push(made);
      return counting.host.create(parent, doc, made);
    },
  };
  return { ...counting, host, events };
}

// The picker part over sessions, main holding `open` pickers and answering
// `finish` with `finish()`, a row for each of SESSION_IDS, `p1-session`
// selected and the page ready. `invoked` holds every channel invoke with its
// arguments; `readAudio` answers three bytes at once. `reload` starts a new
// page over the same slots and readies it, its open pickers read landing after
// the page is ready, as main's answer does; `duringRead` runs once the new page
// is ready and before the read lands, handed the restores the new page tracked.
// `place` reads p1's place; `select` selects a session and lets it settle;
// `togglePopup` runs the sessions command on the live sessions part.
async function startOverOpenPickers(
  open: { forms: PresentedAudioPicker[] },
  finish: () => Promise<void> = () => Promise.resolve(),
) {
  let readHeld: Promise<void> = Promise.resolve();
  const invoked: unknown[][] = [];
  const outputs = fakeOutputs();
  const editors = recordingEditors();
  let togglePopup: () => void = () => undefined;
  const sessions: typeof sessionsPagePart = {
    ...sessionsPagePart,
    start(api) {
      const started = sessionsPagePart.start(api);
      togglePopup = () => void started.commands.togglePopup({ arg: undefined });
      return started;
    },
  };
  const harness = startPagePart(createAudioPickerPagePart(outputs.make), {
    parts: [sessions],
    invoke: async (method, ...args) => {
      invoked.push([method, ...args]);
      switch (method) {
        case 'openForms':
          await readHeld;
          return open.forms;
        case 'readAudio':
          return new Uint8Array([1, 2, 3]);
        case 'draft':
          return undefined;
        case 'finish':
          return finish();
        default:
          return new Promise(() => undefined);
      }
    },
    services: {
      editor: editors.host,
      markdown: PLAIN_MARKDOWN,
      picker: fakeListPickerService(),
    },
  });
  const rows = harness.state.publish(sessionsRowsSlot);
  for (const sessionId of SESSION_IDS) {
    rows.set(sessionId, sessionRow(sessionId));
  }
  const selection = harness.state.publish(sessionsSelectionSlot);
  const select = async (sessionId: string) => {
    selection.set(sessionId);
    await settle();
  };
  selection.set('p1-session');
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
  const place = () =>
    harness.state.read(audioPickerPlaceSlot, 'test').get('p1');
  return {
    harness,
    open,
    invoked,
    outputs,
    editors,
    reload,
    place,
    select,
    togglePopup: () => togglePopup(),
    messages: () => harness.logs.map((line) => line.message),
  };
}

type Setup = Awaited<ReturnType<typeof startOverOpenPickers>>;

// Moment 1's None of these row, under the Cancel prompt.
const CANCEL_PROMPT_ON_NONE: AudioPickerPlace = {
  moment: 0,
  row: 2,
  view: 'confirm',
};

describe('audio picker page part', () => {
  beforeEach(() => {
    installFakeDom((name, value) => vi.stubGlobal(name, value));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('audioPickerPagePart_PickerShown_WiresPopupReadsAndDrafts', async () => {
    const setup = await startOverOpenPickers({ forms: [] });
    const { harness } = setup;
    harness.send('formShown', presentedPicker('p1'));
    await settle();

    harness.started().commands.choose({ arg: 1 });
    harness.advance(audioPickerPagePart.manifest.settings.autosaveDelayMs);
    setup.togglePopup();

    expect(setup.invoked).toContainEqual([
      'readAudio',
      'p1-session',
      { moment: 0, candidate: 0, file: 0 },
    ]);
    expect(setup.invoked.filter(([method]) => method === 'draft')).toEqual([
      [
        'draft',
        'p1',
        {
          answers: [
            { choice: 1, note: '' },
            { choice: 1, note: '' },
          ],
        },
      ],
    ]);
    expect(setup.messages()).toContainEqual(
      expect.stringMatching(/^hid Audio picker popup in /),
    );
    await harness.stop();
  });

  it.each<{
    case: string;
    act(setup: Setup): Promise<void>;
    expected: AudioPickerPlace | undefined;
  }>([
    {
      case: 'a reload restores the cursor and view',
      act: ({ reload }) => reload(),
      expected: CANCEL_PROMPT_ON_NONE,
    },
    {
      case: 'the place survives the first formShown write',
      act: ({ reload, harness }) =>
        reload(() => harness.send('formShown', presentedPicker('p1'))),
      expected: CANCEL_PROMPT_ON_NONE,
    },
    {
      case: 'formClosed deletes the place',
      act: async ({ harness }) =>
        harness.send('formClosed', { formId: 'p1', byFinish: false }),
      expected: undefined,
    },
    {
      case: 'a picker closed while no page ran is pruned',
      act: async ({ open, reload }) => {
        open.forms = [];
        await reload();
      },
      expected: undefined,
    },
  ])(
    'audioPickerPagePart_Place_SurvivesAReload: $case',
    async ({ act, expected }) => {
      const setup = await startOverOpenPickers({
        forms: [presentedPicker('p1')],
      });
      const { commands } = setup.harness.started();
      commands.nextRow({} as PageCommandContext);
      commands.askCancel({} as PageCommandContext);
      expect(setup.place()).toEqual(CANCEL_PROMPT_ON_NONE);

      await act(setup);

      expect(setup.place()).toEqual(expected);
      await setup.harness.stop();
    },
  );

  it('audioPickerPagePart_OpenFormsRead_IsTrackedAsARestore', async () => {
    const setup = await startOverOpenPickers({
      forms: [presentedPicker('p1')],
    });
    const { harness, reload, place } = setup;
    const { commands } = harness.started();
    commands.nextRow({} as PageCommandContext);
    commands.askCancel({} as PageCommandContext);
    const settledPlaces: unknown[] = [];
    let tracked = 0;
    let settledDuringRead = 0;

    await reload(async (restores) => {
      tracked = restores.length;
      for (const restore of restores) {
        void restore.then(() => settledPlaces.push(place()));
      }
      await settle();
      settledDuringRead = settledPlaces.length;
    });

    // Sessions' own restore settles before the read lands.
    expect([
      tracked - settledDuringRead,
      settledPlaces.slice(settledDuringRead),
    ]).toEqual([1, [CANCEL_PROMPT_ON_NONE]]);
    await harness.stop();
  });

  it.each<
    [string, ('submit' | 'askCancel' | 'confirmCancel')[], boolean, string[]]
  >([
    ['a submit main takes', ['submit'], true, ['sent']],
    [
      'a cancel main takes',
      ['askCancel', 'confirmCancel'],
      true,
      ['cancelled'],
    ],
    ['a submit main refuses', ['submit'], false, []],
  ])(
    'audioPickerPagePart_Finish_LogsSentOrCancelled: %s',
    async (_name, commandNames, isTaken, lines) => {
      const setup = await startOverOpenPickers(
        { forms: [presentedPicker('p1')] },
        () =>
          isTaken ? Promise.resolve() : Promise.reject(new Error('kept open')),
      );
      const { commands } = setup.harness.started();

      for (const name of commandNames) {
        void commands[name]({} as PageCommandContext);
      }
      await settle();

      expect(
        setup
          .messages()
          .filter((message) => message === 'sent' || message === 'cancelled'),
      ).toEqual(lines);
      await setup.harness.stop();
    },
  );

  it('audioPickerPagePart_NotesBoxFocused_LogsTheMoment', async () => {
    const setup = await startOverOpenPickers({
      forms: [presentedPicker('p1')],
    });
    const { commands } = setup.harness.started();
    commands.nextMoment({} as PageCommandContext);
    // The picker's boxes mount last, moment 2's after moment 1's.
    const moment2Box = setup.editors.events[setup.editors.events.length - 1];

    commands.editNote({} as PageCommandContext);
    moment2Box.blurred();
    moment2Box.focused();

    expect(
      setup
        .messages()
        .filter((message) => message === 'focused note on moment 2'),
    ).toEqual(['focused note on moment 2', 'focused note on moment 2']);
    await setup.harness.stop();
  });

  it('audioPickerPagePart_PopupHidden_StopsPlayback', async () => {
    const setup = await startOverOpenPickers({
      forms: [presentedPicker('p1', { form: soundsPicker() })],
    });
    await settle();
    const { commands } = setup.harness.started();
    commands.playRow({ arg: { moment: 1, candidate: 0 } });
    setup.harness.advance(VISIBILITY_POLL_MS);
    const stopsWhileShown = setup.outputs.plays.map((play) => play.stops);

    setup.togglePopup();
    setup.harness.advance(VISIBILITY_POLL_MS);

    expect(stopsWhileShown).toEqual([0]);
    expect(setup.outputs.plays.map((play) => play.stops)).toEqual([1]);
    expect(setup.messages()).toContain('stop Rain');
    await setup.harness.stop();
  });

  it.each<[string, string, PresentedAudioPicker | null]>([
    [
      "the active session's picker",
      'p2-session',
      {
        formId: 'p2',
        sessionId: 'p2-session',
        label: 'project · p2',
        form: twoMomentPicker(),
        draft: {
          answers: [
            { choice: 2, note: '' },
            { choice: 1, note: '' },
          ],
        },
      },
    ],
    ['a session with no picker', 'other-session', null],
  ])(
    'audioPickerPagePart_ActivePicker_IsTheActiveSessionsPicker: %s',
    async (_name, sessionId, expected) => {
      const setup = await startOverOpenPickers({
        forms: [presentedPicker('p1'), presentedPicker('p2')],
      });
      await setup.select(sessionId);
      const exports = setup.harness
        .started()
        .exports?.(createRegistrations()) as AudioPickerPageExports;

      const picker = exports.activePicker();

      expect(picker).toEqual(expected);
      await setup.harness.stop();
    },
  );

  it('audioPickerPagePart_Stop_LeavesNothingLive', async () => {
    const forms = deferred<PresentedAudioPicker[]>();
    const bytes = deferred<Uint8Array>();
    const outputs = fakeOutputs();
    const editors = countingEditors();
    const harness = startPagePart(createAudioPickerPagePart(outputs.make), {
      parts: [sessionsPagePart],
      invoke: (method) => {
        if (method === 'openForms') {
          return forms.promise;
        }
        return method === 'readAudio'
          ? bytes.promise
          : new Promise(() => undefined);
      },
      services: {
        editor: editors.host,
        markdown: PLAIN_MARKDOWN,
        picker: fakeListPickerService(),
      },
    });
    harness.send('formShown', presentedPicker('p1'));
    const made = editors.made();

    await harness.stop();
    const logged = harness.logs.length;
    forms.resolve([presentedPicker('p2')]);
    bytes.resolve(new Uint8Array([1, 2, 3]));
    await settle();

    expect(made).toBeGreaterThan(0);
    expect(editors.made()).toBe(made);
    expect(harness.logs.slice(logged)).toEqual([]);
    expect(outputs.outputs).toEqual([{ isDisposed: true }]);
    expect(harness.counts()).toEqual(noCounts);
  });
});
