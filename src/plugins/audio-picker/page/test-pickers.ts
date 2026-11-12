import type {
  AudioCandidate,
  AudioMoment,
  AudioPickerBody,
  AudioPickerForm,
  PresentedAudioPicker,
} from '../contract';

export function audioCandidate(
  name: string,
  overrides: Partial<AudioCandidate> = {},
): AudioCandidate {
  return {
    name,
    library: `${name} library`,
    files: [`/sounds/${name}.wav`],
    play: 'one-shot',
    volume: 1,
    pitch: null,
    loudnessLufs: null,
    driveUrl: null,
    ...overrides,
  };
}

export function audioMoment(
  title: string,
  candidates: AudioCandidate[],
  recommend: number,
): AudioMoment {
  return { title, reason: `${title} reason`, candidates, recommend };
}

// Two moments: moment 1 with candidates `Soft chime` and `Bright chime`,
// recommending 2; moment 2 with `Low thud`, `Mid thud` and `High thud`,
// recommending 1.
export function twoMomentPicker(): AudioPickerForm {
  return {
    heading: 'Pick the menu sounds',
    overview: 'Two moments of the menu.',
    moments: [
      audioMoment(
        'Button press',
        [audioCandidate('Soft chime'), audioCandidate('Bright chime')],
        2,
      ),
      audioMoment(
        'Panel close',
        [
          audioCandidate('Low thud'),
          audioCandidate('Mid thud'),
          audioCandidate('High thud'),
        ],
        1,
      ),
    ],
  };
}

// Five files: moment 1 holds the one-shot `Click` (volume 0.6) and the
// 3-file variants `Steps`; moment 2 the loop `Rain`. Each recommends 1.
export function soundsPicker(): AudioPickerForm {
  return {
    heading: 'Pick the level sounds',
    overview: 'Clicks, steps and rain.',
    moments: [
      audioMoment(
        'Tap',
        [
          audioCandidate('Click', { volume: 0.6 }),
          audioCandidate('Steps', {
            play: 'variants',
            files: [
              '/sounds/step-1.wav',
              '/sounds/step-2.wav',
              '/sounds/step-3.wav',
            ],
          }),
        ],
        1,
      ),
      audioMoment('Weather', [audioCandidate('Rain', { play: 'loop' })], 1),
    ],
  };
}

export function presentedPicker(
  formId: string,
  parts: { form?: AudioPickerForm; draft?: AudioPickerBody | null } = {},
): PresentedAudioPicker {
  return {
    formId,
    sessionId: `${formId}-session`,
    label: `project · ${formId}`,
    form: parts.form ?? twoMomentPicker(),
    draft: parts.draft ?? null,
  };
}
