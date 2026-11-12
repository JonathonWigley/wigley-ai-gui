import { describe, expect, it } from 'vitest';
import { posixPaths } from '../../../shared/paths/posix-paths';
import {
  AUDIO_EXTENSIONS,
  AUDIO_PICKER_ERROR_NAME,
  type AudioPickerForm,
  MAX_CANDIDATES,
  MAX_MOMENTS,
  MAX_PITCH_SEMITONES,
  MAX_VARIANT_FILES,
} from '../contract';
import {
  audioPickerFingerprint,
  audioPickerHandedBackPayload,
  audioPickerNotShownPayload,
  audioPickerPayload,
  autoAnsweredPayload,
  noAudioPickerPayload,
  parseAudioPicker,
  readAudioPickerBody,
  recommendedBody,
  savedAudioPickerHeading,
} from './picker';

type Args = Record<string, unknown>;

function candidateArgs(overrides: Args = {}): Args {
  return {
    name: 'Coin',
    library: 'Kit A',
    files: ['/sounds/coin.wav'],
    play: 'one-shot',
    volume: 0.8,
    pitch: { min: -1, max: 1 },
    ...overrides,
  };
}

function momentArgs(overrides: Args = {}): Args {
  return {
    title: 'Coin pickup',
    reason: 'Plays when a coin is collected.',
    recommend: 2,
    candidates: [
      candidateArgs(),
      candidateArgs({ name: 'Chime', files: ['/sounds/chime.mp3'] }),
    ],
    ...overrides,
  };
}

function pickerArgs(overrides: Args = {}): Args {
  return {
    heading: 'Shop sounds',
    moments: [momentArgs(), momentArgs({ title: 'Purchase' })],
    ...overrides,
  };
}

// The picker with its second moment's fields overridden.
function withMoment(overrides: Args): Args {
  return pickerArgs({ moments: [momentArgs(), momentArgs(overrides)] });
}

// The picker with the second moment's second candidate's fields overridden.
function withCandidate(overrides: Args): Args {
  return withMoment({
    candidates: [candidateArgs(), candidateArgs(overrides)],
  });
}

function parse(args: unknown): AudioPickerForm {
  return parseAudioPicker(args, posixPaths);
}

// Moment 1 holds three candidates and recommends the second; moment 2 holds
// two and recommends the first.
function twoMomentForm(): AudioPickerForm {
  return parse({
    heading: 'Shop sounds',
    moments: [
      momentArgs({
        title: 'Coin pickup',
        recommend: 2,
        candidates: [
          candidateArgs({ name: 'Coin', files: ['/sounds/coin.wav'] }),
          candidateArgs({ name: 'Chime', files: ['/sounds/chime.mp3'] }),
          candidateArgs({ name: 'Bell', files: ['/sounds/bell.ogg'] }),
        ],
      }),
      momentArgs({
        title: 'Purchase',
        recommend: 1,
        candidates: [
          candidateArgs({ name: 'Till', files: ['/sounds/till.wav'] }),
          candidateArgs({ name: 'Pop', files: ['/sounds/pop.flac'] }),
        ],
      }),
    ],
  });
}

// Moment 1 on its candidate 2 and moment 2 on None of these, with a note.
const ONE_CHOSEN_ONE_NONE = {
  answers: [
    { choice: 2, note: '' },
    { choice: 0, note: 'brighter' },
  ],
};

describe('parseAudioPicker', () => {
  it.each([
    { name: 'left out', candidate: {}, picker: {} },
    {
      name: 'sent as null',
      candidate: { pitch: null, loudness_lufs: null, drive_url: null },
      picker: { overview: null },
    },
  ])(
    'parses snake_case args into the form, filling the absent optionals (optionals $name)',
    ({ candidate, picker }) => {
      const form = parse({
        heading: ' Shop sounds ',
        moments: [
          {
            title: ' Coin pickup ',
            reason: 'Plays when a coin is collected.',
            recommend: 2,
            candidates: [
              {
                name: ' Coin ',
                library: 'Kit A',
                files: ['/sounds/./kit//coin.wav'],
                play: 'one-shot',
                volume: 0.8,
                pitch: { min: -2, max: 3 },
                loudness_lufs: -14.5,
                drive_url: ' https://drive.example/coin ',
              },
              {
                name: 'Chime',
                library: 'Kit B',
                files: ['/sounds/chime_a.ogg', '/sounds/chime_b.ogg'],
                play: 'variants',
                volume: 0.35,
                ...candidate,
              },
            ],
          },
        ],
        ...picker,
      });

      expect(form).toEqual({
        heading: 'Shop sounds',
        overview: '',
        moments: [
          {
            title: 'Coin pickup',
            reason: 'Plays when a coin is collected.',
            candidates: [
              {
                name: 'Coin',
                library: 'Kit A',
                files: ['/sounds/kit/coin.wav'],
                play: 'one-shot',
                volume: 0.8,
                pitch: { min: -2, max: 3 },
                loudnessLufs: -14.5,
                driveUrl: 'https://drive.example/coin',
              },
              {
                name: 'Chime',
                library: 'Kit B',
                files: ['/sounds/chime_a.ogg', '/sounds/chime_b.ogg'],
                play: 'variants',
                volume: 0.35,
                pitch: null,
                loudnessLufs: null,
                driveUrl: null,
              },
            ],
            recommend: 2,
          },
        ],
      });
    },
  );

  const C = 'moments[2].candidates[2]';
  const tooManyVariants = Array.from(
    { length: MAX_VARIANT_FILES + 1 },
    (_, i) => `/sounds/sparkle_${i}.wav`,
  );

  it.each([
    { rule: 'args not an object', args: 'x', holds: ['args', "'x'"] },
    {
      rule: 'blank heading',
      args: pickerArgs({ heading: '  ' }),
      holds: ['heading', "'  '"],
    },
    {
      rule: 'overview not a string',
      args: pickerArgs({ overview: 5 }),
      holds: ['overview', '5'],
    },
    {
      rule: 'moments not an array',
      args: pickerArgs({ moments: 'all' }),
      holds: ['moments', "'all'"],
    },
    {
      rule: 'moments empty',
      args: pickerArgs({ moments: [] }),
      holds: ['moments', 'holds 0'],
    },
    {
      rule: 'one moment too many',
      args: pickerArgs({
        moments: Array.from({ length: MAX_MOMENTS + 1 }, () => momentArgs()),
      }),
      holds: ['moments', `holds ${MAX_MOMENTS + 1}`],
    },
    {
      rule: 'a moment not an object',
      args: pickerArgs({ moments: [momentArgs(), 'tap'] }),
      holds: ['moments[2]', "'tap'"],
    },
    {
      rule: 'candidates not an array',
      args: withMoment({ candidates: 'coin' }),
      holds: ['moments[2].candidates', "'coin'"],
    },
    {
      rule: 'a candidate not an object',
      args: withMoment({ candidates: [candidateArgs(), 7] }),
      holds: [C, '7'],
    },
    {
      rule: 'files not an array',
      args: withCandidate({ files: '/sounds/a.wav' }),
      holds: [`${C}.files`, "'/sounds/a.wav'"],
    },
    {
      rule: 'pitch not an object',
      args: withCandidate({ pitch: 'wide' }),
      holds: [`${C}.pitch`, "'wide'"],
    },
    {
      rule: 'pitch min not a number',
      args: withCandidate({ pitch: { min: 'low', max: 1 } }),
      holds: [`${C}.pitch.min`, "'low'"],
    },
    {
      rule: 'drive_url not a string',
      args: withCandidate({ drive_url: 5 }),
      holds: [`${C}.drive_url`, '5'],
    },
    {
      rule: 'blank title',
      args: withMoment({ title: '' }),
      holds: ['moments[2].title', "''"],
    },
    {
      rule: 'blank reason',
      args: withMoment({ reason: ' ' }),
      holds: ['moments[2].reason', "' '"],
    },
    {
      rule: 'candidates empty',
      args: withMoment({ candidates: [] }),
      holds: ['moments[2].candidates', 'holds 0'],
    },
    {
      rule: 'one candidate too many',
      args: withMoment({
        candidates: Array.from({ length: MAX_CANDIDATES + 1 }, () =>
          candidateArgs(),
        ),
      }),
      holds: ['moments[2].candidates', `holds ${MAX_CANDIDATES + 1}`],
    },
    {
      rule: 'recommend 0',
      args: withMoment({ recommend: 0 }),
      holds: ['moments[2].recommend', '0'],
    },
    {
      rule: 'recommend past the last candidate',
      args: withMoment({ recommend: 3 }),
      holds: ['moments[2].recommend', '3'],
    },
    {
      rule: 'recommend not an integer',
      args: withMoment({ recommend: 1.5 }),
      holds: ['moments[2].recommend', '1.5'],
    },
    {
      rule: 'unknown play',
      args: withCandidate({ play: 'stream' }),
      holds: [`${C}.play`, "'stream'"],
    },
    {
      rule: 'a one-shot with 2 files',
      args: withCandidate({ files: ['/sounds/a.wav', '/sounds/b.wav'] }),
      holds: [`${C}.files`, 'holds 2'],
    },
    {
      rule: 'a variants with 1 file',
      args: withCandidate({ play: 'variants', files: ['/sounds/a.wav'] }),
      holds: [`${C}.files`, 'holds 1'],
    },
    {
      rule: 'a variants with one file too many',
      args: withCandidate({ play: 'variants', files: tooManyVariants }),
      holds: [`${C}.files`, `holds ${MAX_VARIANT_FILES + 1}`],
    },
    {
      rule: 'files empty',
      args: withCandidate({ files: [] }),
      holds: [`${C}.files`, 'holds 0'],
    },
    {
      rule: 'a files entry not a string',
      args: withCandidate({ files: [5] }),
      holds: [`${C}.files[1]`, '5'],
    },
    {
      rule: 'a blank files entry',
      args: withCandidate({ files: ['  '] }),
      holds: [`${C}.files[1]`, "'  '"],
    },
    {
      rule: 'a relative path',
      args: withCandidate({ files: ['sounds/a.wav'] }),
      holds: [`${C}.files[1]`, "'sounds/a.wav'", 'must be an absolute path'],
    },
    {
      rule: 'a path with no audio extension',
      args: withCandidate({ files: ['/sounds/a.txt'] }),
      holds: [`${C}.files[1]`, "'/sounds/a.txt'", '.wav'],
    },
    {
      rule: 'volume over 1',
      args: withCandidate({ volume: 1.5 }),
      holds: [`${C}.volume`, '1.5'],
    },
    {
      rule: 'volume under 0',
      args: withCandidate({ volume: -0.1 }),
      holds: [`${C}.volume`, '-0.1'],
    },
    {
      rule: 'volume a string',
      args: withCandidate({ volume: '0.5' }),
      holds: [`${C}.volume`, "'0.5'"],
    },
    {
      rule: 'pitch min over max',
      args: withCandidate({ pitch: { min: 3, max: -3 } }),
      holds: [`${C}.pitch`, '{"min":3,"max":-3}'],
    },
    {
      rule: 'pitch max past the limit',
      args: withCandidate({ pitch: { min: 0, max: MAX_PITCH_SEMITONES + 1 } }),
      holds: [`${C}.pitch.max`, `${MAX_PITCH_SEMITONES + 1}`],
    },
    {
      rule: 'pitch min past the limit',
      args: withCandidate({
        pitch: { min: -MAX_PITCH_SEMITONES - 1, max: 0 },
      }),
      holds: [`${C}.pitch.min`, `${-MAX_PITCH_SEMITONES - 1}`],
    },
    {
      rule: 'loudness_lufs not a number',
      args: withCandidate({ loudness_lufs: 'loud' }),
      holds: [`${C}.loudness_lufs`, "'loud'"],
    },
    {
      rule: 'a blank candidate name',
      args: withCandidate({ name: '' }),
      holds: [`${C}.name`, "''"],
    },
    {
      rule: 'a blank library',
      args: withCandidate({ library: ' ' }),
      holds: [`${C}.library`, "' '"],
    },
    {
      rule: 'a blank drive_url',
      args: withCandidate({ drive_url: '' }),
      holds: [`${C}.drive_url`, "''"],
    },
  ])(
    'rejects each malformed call with an AudioPickerError naming the field ($rule)',
    ({ args, holds }) => {
      let caught: unknown = null;
      try {
        parse(args);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).name).toBe(AUDIO_PICKER_ERROR_NAME);
      for (const part of holds) {
        expect((caught as Error).message).toContain(part);
      }
    },
  );

  it.each(AUDIO_EXTENSIONS.map((extension) => extension.toUpperCase()))(
    'accepts every audio extension in any case (%s)',
    (extension) => {
      const path = `/sounds/coin${extension}`;

      const form = parse(withCandidate({ files: [path] }));

      expect(form.moments[1].candidates[1].files).toEqual([path]);
    },
  );
});

describe('readAudioPickerBody', () => {
  it.each([
    {
      name: 'a valid choice and note',
      raw: { answers: [{ choice: 3, note: 'x' }, { choice: 2 }] },
      expected: [
        { choice: 3, note: 'x' },
        { choice: 2, note: '' },
      ],
    },
    {
      name: 'choice 0',
      raw: { answers: [{ choice: 0, note: 'softer' }] },
      expected: [
        { choice: 0, note: 'softer' },
        { choice: 1, note: '' },
      ],
    },
    {
      name: 'choice past the last candidate',
      raw: { answers: [{ choice: 4 }, { choice: 3 }] },
      expected: [
        { choice: 2, note: '' },
        { choice: 1, note: '' },
      ],
    },
    {
      name: 'choice -1',
      raw: { answers: [{ choice: -1 }, { choice: -1 }] },
      expected: [
        { choice: 2, note: '' },
        { choice: 1, note: '' },
      ],
    },
    {
      name: 'choice a string',
      raw: { answers: [{ choice: '3' }, { choice: '2' }] },
      expected: [
        { choice: 2, note: '' },
        { choice: 1, note: '' },
      ],
    },
    {
      name: 'choice not an integer',
      raw: { answers: [{ choice: 1.5 }, { choice: 1.5 }] },
      expected: [
        { choice: 2, note: '' },
        { choice: 1, note: '' },
      ],
    },
    {
      name: 'note not a string',
      raw: { answers: [{ choice: 1, note: 5 }] },
      expected: [
        { choice: 1, note: '' },
        { choice: 1, note: '' },
      ],
    },
    {
      name: 'no answers',
      raw: {},
      expected: [
        { choice: 2, note: '' },
        { choice: 1, note: '' },
      ],
    },
    {
      name: 'answers past the last moment',
      raw: {
        answers: [
          { choice: 1, note: 'a' },
          { choice: 2, note: 'b' },
          { choice: 1, note: 'c' },
        ],
      },
      expected: [
        { choice: 1, note: 'a' },
        { choice: 2, note: 'b' },
      ],
    },
    {
      name: 'raw a string',
      raw: 'answers',
      expected: [
        { choice: 2, note: '' },
        { choice: 1, note: '' },
      ],
    },
  ])(
    "keeps a valid choice and note and the form's own for anything else ($name)",
    ({ raw, expected }) => {
      expect(readAudioPickerBody(twoMomentForm(), raw)).toEqual({
        answers: expected,
      });
    },
  );

  it('recommendedBody puts each moment on its recommend', () => {
    expect(recommendedBody(twoMomentForm())).toEqual({
      answers: [
        { choice: 2, note: '' },
        { choice: 1, note: '' },
      ],
    });
  });
});

describe('audioPickerFingerprint', () => {
  const base = audioPickerFingerprint(parse(pickerArgs()));

  it('matches a re-send', () => {
    expect(audioPickerFingerprint(parse(pickerArgs()))).toBe(base);
  });

  it.each([
    {
      change: 'a file path',
      args: withCandidate({ files: ['/sounds/b.wav'] }),
    },
    { change: 'a volume', args: withCandidate({ volume: 0.5 }) },
    {
      change: 'a pitch bound',
      args: withCandidate({ pitch: { min: -1, max: 2 } }),
    },
    { change: 'the heading', args: pickerArgs({ heading: 'Shop sounds 2' }) },
  ])('changes with $change', ({ args }) => {
    expect(audioPickerFingerprint(parse(args))).not.toBe(base);
  });
});

describe('savedAudioPickerHeading', () => {
  it.each([
    { args: { heading: ' Shop ' }, heading: 'Shop' },
    { args: {}, heading: null },
    { args: 'x', heading: null },
  ])('reads $args as $heading', ({ args, heading }) => {
    expect(savedAudioPickerHeading(args)).toBe(heading);
  });
});

describe('audioPickerPayload', () => {
  it("gives each moment's title, choice, chosen candidate and note", () => {
    const form = twoMomentForm();

    const payload = audioPickerPayload(form, 'submitted', ONE_CHOSEN_ONE_NONE);

    expect(payload.outcome).toBe('submitted');
    expect(payload.picks).toEqual([
      {
        moment: 'Coin pickup',
        choice: 2,
        candidate: form.moments[0].candidates[1],
        note: '',
      },
      { moment: 'Purchase', choice: 0, candidate: null, note: 'brighter' },
    ]);
  });

  it.each([
    {
      name: 'submitted',
      outcome: 'submitted' as const,
      form: twoMomentForm,
      body: ONE_CHOSEN_ONE_NONE,
      summary: '2 moments: 1 chosen, 1 None of these.',
      next: ['search again', 'new picker'],
    },
    {
      name: 'draft',
      outcome: 'draft' as const,
      form: twoMomentForm,
      body: ONE_CHOSEN_ONE_NONE,
      summary:
        '2 moments: 1 chosen, 1 None of these. The picker is still open.',
      next: ['collect_last_audio_picker'],
    },
    {
      name: 'cancelled',
      outcome: 'cancelled' as const,
      form: twoMomentForm,
      body: ONE_CHOSEN_ONE_NONE,
      summary: '2 moments: 1 chosen, 1 None of these.',
      next: ['wire nothing'],
    },
    {
      name: 'submitted, one moment',
      outcome: 'submitted' as const,
      form: () => parse(pickerArgs({ moments: [momentArgs()] })),
      body: { answers: [{ choice: 0, note: '' }] },
      summary: '1 moment: 0 chosen, 1 None of these.',
      next: ['search again'],
    },
  ])('gives each outcome its summary and next ($name)', (row) => {
    const payload = audioPickerPayload(row.form(), row.outcome, row.body);

    expect(payload.summary).toBe(row.summary);
    for (const part of row.next) {
      expect(payload.next).toContain(part);
    }
  });

  it('gives an auto-answered picker a next naming the recommendation', () => {
    const form = twoMomentForm();

    const payload = autoAnsweredPayload(form, recommendedBody(form));

    expect(payload.next).toContain('recommendation');
  });
});

describe('the other payloads', () => {
  it('auto-answers with the recommended picks; hands back, not-shown and no-form name what they need', () => {
    const form = twoMomentForm();

    const auto = autoAnsweredPayload(form, recommendedBody(form));
    const handedBack = audioPickerHandedBackPayload(
      form,
      'submitted',
      ONE_CHOSEN_ONE_NONE,
    );
    const notShown = audioPickerNotShownPayload(form, 'Menu sounds');
    const none = noAudioPickerPayload();
    const draft = audioPickerPayload(form, 'draft', ONE_CHOSEN_ONE_NONE);

    expect(auto.outcome).toBe('auto_answered');
    expect(auto.picks?.map((pick) => pick.candidate)).toEqual([
      form.moments[0].candidates[1],
      form.moments[1].candidates[0],
    ]);
    expect(handedBack.earlier_heading).toBe('Shop sounds');
    expect(notShown.outcome).toBe('draft');
    expect(notShown.next).toContain("'Menu sounds'");
    expect(notShown.picks?.map((pick) => pick.choice)).toEqual([2, 1]);
    expect(none.outcome).toBe('no_audio_picker');
    expect(none).not.toHaveProperty('picks');
    expect(draft.next).toContain('collect_last_audio_picker');
  });
});
