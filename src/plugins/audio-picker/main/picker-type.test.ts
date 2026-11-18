import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentFormAutoAnswer,
  AgentFormOwnerInfo,
  AgentFormSession,
} from '../../../contracts/agent-forms';
import { NO_FORM_WAKE } from '../../../shared/agent-forms/chat-wake';
import { createAgentFormService } from '../../../shared/agent-forms/form-service';
import type { AgentFormStore } from '../../../shared/agent-forms/form-store';
import { globalTimers } from '../../../shared/agent-forms/global-timers.test-support';
import { createMemoryFormStore } from '../../../shared/agent-forms/memory-form-store';
import { ScriptedFormPresenter } from '../../../shared/agent-forms/scripted-presenter';
import { createAgentFormToolSession } from '../../../shared/agent-forms/tool-session';
import { posixPaths } from '../../../shared/paths/posix-paths';
import type {
  AudioPickerBody,
  AudioPickerForm,
  AudioPickerPayload,
} from '../contract';
import { audioPickerFingerprint, parseAudioPicker } from './picker';
import { AudioPickerError } from './picker-error';
import { audioPickerAutoAnswer, createAudioPickerType } from './picker-type';

const DEFAULT_DEADLINE_SECONDS = 240;

const APP_SESSION_ID = 'app-1';

const SESSION: AgentFormOwnerInfo = {
  sessionId: 'session-1',
  projectDir: '/work/game',
};

// Two moments: the first recommends its candidate 2 of 2, the second its
// candidate 1 of 2.
const PICKER_ARGS = {
  heading: 'Shop sounds',
  moments: [
    {
      title: 'Coin pickup',
      reason: 'Plays when a coin is collected.',
      recommend: 2,
      candidates: [
        {
          name: 'Coin',
          library: 'Kit A',
          files: ['/sounds/coin.wav'],
          play: 'one-shot',
          volume: 0.8,
        },
        {
          name: 'Chime',
          library: 'Kit A',
          files: ['/sounds/chime.mp3'],
          play: 'one-shot',
          volume: 0.6,
        },
      ],
    },
    {
      title: 'Shop music',
      reason: 'Loops while the shop is open.',
      recommend: 1,
      candidates: [
        {
          name: 'Market',
          library: 'Kit B',
          files: ['/sounds/market.ogg'],
          play: 'loop',
          volume: 0.4,
        },
        {
          name: 'Bazaar',
          library: 'Kit B',
          files: ['/sounds/bazaar.ogg'],
          play: 'loop',
          volume: 0.4,
        },
      ],
    },
  ],
};

// Moment 1 on Coin, moment 2 on None of these with a note.
const ANSWERED: AudioPickerBody = {
  answers: [
    { choice: 1, note: '' },
    { choice: 0, note: 'calmer' },
  ],
};

const type = createAudioPickerType(posixPaths);

let presenter: ScriptedFormPresenter<AudioPickerForm, AudioPickerBody>;
let store: AgentFormStore;
let hexCount: number;

function startSession(
  autoAnswer?: AgentFormAutoAnswer<
    AudioPickerForm,
    AudioPickerBody,
    AudioPickerPayload
  >,
): AgentFormSession<AudioPickerPayload> {
  return createAgentFormService({
    type,
    presenter,
    store,
    wake: NO_FORM_WAKE,
    defaultDeadlineSeconds: () => DEFAULT_DEADLINE_SECONDS,
    timers: globalTimers,
    autoAnswer,
  }).startSession({ id: APP_SESSION_ID, info: SESSION });
}

function live(): AbortSignal {
  return new AbortController().signal;
}

beforeEach(() => {
  vi.useFakeTimers();
  hexCount = 0;
  presenter = new ScriptedFormPresenter();
  store = createMemoryFormStore(
    { now: () => 1_000_000 },
    () => (++hexCount).toString(16).padStart(8, '0'),
    posixPaths,
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the audio picker type through the agent form service', () => {
  it("returns the user's submitted picks", async () => {
    const pending = startSession().open(PICKER_ARGS, null, live());
    const shown = presenter.latest();
    presenter.submit(shown.formId, ANSWERED);

    const payload = await pending;

    expect(shown.label).toContain('Shop sounds');
    expect(payload.outcome).toBe('submitted');
    const answers = payload.picks?.map(({ choice, note }) => ({
      choice,
      note,
    }));
    expect(answers).toEqual(ANSWERED.answers);
    expect(payload.picks?.[0].candidate?.name).toBe('Coin');
  });

  it('returns a draft at the deadline and the submitted picks to collect_last_audio_picker', async () => {
    const session = startSession();
    const pending = session.open(PICKER_ARGS, null, live());
    const shown = presenter.latest();
    await vi.advanceTimersByTimeAsync(DEFAULT_DEADLINE_SECONDS * 1000);

    const draft = await pending;
    presenter.submit(shown.formId, ANSWERED);
    const collected = await session.collect(true, live());

    expect(draft.outcome).toBe('draft');
    expect(draft.next).toContain('collect_last_audio_picker');
    expect(collected.outcome).toBe('submitted');
    expect(collected.picks?.[1].note).toBe('calmer');
  });

  it('rejects a malformed open_audio_picker with its AudioPickerError and shows nothing', async () => {
    const rejection = startSession().open(
      { heading: 'Shop sounds', moments: [] },
      null,
      live(),
    );

    await expect(rejection).rejects.toBeInstanceOf(AudioPickerError);
    await expect(rejection).rejects.toThrow('moments');
    expect(presenter.shown).toEqual([]);
  });

  it("pre-fills a re-sent picker with the user's saved answers", () => {
    store.create(
      SESSION,
      audioPickerFingerprint(parseAudioPicker(PICKER_ARGS, posixPaths)),
      PICKER_ARGS,
      ANSWERED,
      null,
    );

    void startSession().open(PICKER_ARGS, null, live());

    expect(presenter.latest().draft).toEqual(ANSWERED);
  });

  it('auto-answers while isOn says so: the recommended picks at once, nothing shown', async () => {
    const session = startSession(
      audioPickerAutoAnswer((sessionId) => sessionId === APP_SESSION_ID),
    );

    const payload = await session.open(PICKER_ARGS, null, live());

    expect(payload.outcome).toBe('auto_answered');
    expect(payload.picks?.map((pick) => pick.candidate?.name)).toEqual([
      'Chime',
      'Market',
    ]);
    expect(presenter.shown).toEqual([]);
  });
});

describe('the audio picker type through its tool session', () => {
  it("returns a malformed open_audio_picker's message as its tool error text", async () => {
    let message = '';
    try {
      parseAudioPicker('nope', posixPaths);
    } catch (error) {
      message = (error as AudioPickerError).message;
    }
    const session: AgentFormSession<AudioPickerPayload> = {
      open: async (args) => {
        type.parse(args);
        throw new Error('the picker parsed');
      },
      collect: () => Promise.reject(new Error('collect is not called here')),
      end: () => {},
    };

    const result = await createAgentFormToolSession(session, type).call(
      'open_audio_picker',
      'nope',
      { toolUseId: null, signal: new AbortController().signal },
    );

    expect(message).not.toBe('');
    expect(result).toEqual({
      content: [{ type: 'text', text: message }],
      isError: true,
    });
  });
});
