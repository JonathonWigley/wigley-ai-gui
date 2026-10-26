import { describe, expect, it } from 'vitest';
import type { Primer, PrimerBody, PrimerEntry } from '../contract';
import { SAMPLE_PRIMER_ARGS } from './fixtures';
import {
  noPrimerPayload,
  parsePrimer,
  primerFingerprint,
  primerHandedBackPayload,
  primerNotShownPayload,
  primerPayload,
  readPrimerBody,
  savedPrimerHeading,
} from './primer';
import { PrimerError } from './primer-error';

const FEATURE = SAMPLE_PRIMER_ARGS.feature;

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: '1',
    task: 'Data model',
    need: 'yes',
    items: ['Add the record type'],
    ...overrides,
  };
}

// The sample with its entries replaced by `entries`.
function argsWith(entries: unknown): Record<string, unknown> {
  return { feature: FEATURE, entries };
}

function sample(): Primer {
  return parsePrimer(SAMPLE_PRIMER_ARGS);
}

function entryOf(entries: PrimerEntry[] | undefined, id: string): PrimerEntry {
  const found = entries?.find((each) => each.id === id);
  if (found === undefined) {
    throw new Error(`no entry ${id}`);
  }
  return found;
}

function expectRejects(args: unknown, message: string) {
  expect(() => parsePrimer(args)).toThrow(PrimerError);
  expect(() => parsePrimer(args)).toThrow(message);
}

describe('parsePrimer', () => {
  it('parses the sample into a primer with blank comments and every item included', () => {
    const primer = sample();

    expect(primer.feature).toEqual({
      name: 'Sample feature',
      slug: 'sample-feature',
      spec: 'docs/sample-spec.md',
      summary: 'A sample feature the primer tests and the self-test open.',
      notes: '',
    });
    expect(primer.entries.map((each) => each.need)).toEqual([
      'yes',
      'unclear',
      'no',
      'yes',
    ]);
    expect(entryOf(primer.entries, '3')).toEqual({
      id: '3',
      group: 'primer',
      number: 3,
      area: 'Audio',
      question: 'Audio',
      task: 'Audio',
      need: 'no',
      evidence: '',
      probes: '',
      pointer: '',
      comment: '',
      items: [
        {
          text: 'Add the sound cues',
          include: true,
          comment: '',
          added: false,
        },
      ],
    });
    expect(entryOf(primer.entries, 'tests').group).toBe('standing');
  });

  it('rejects args that are not an object', () => {
    expectRejects(
      ['feature'],
      "open_primer takes an object with 'feature' and 'entries'.",
    );
  });

  it('rejects a missing feature', () => {
    expectRejects(
      { entries: [entry()] },
      "'feature' must be an object with name, slug, spec and summary.",
    );
  });

  it('rejects a blank feature name', () => {
    expectRejects(
      { feature: { ...FEATURE, name: '  ' }, entries: [entry()] },
      'feature.name is required and must be a non-empty string.',
    );
  });

  it('rejects a slug outside the slug rule', () => {
    expectRejects(
      { feature: { ...FEATURE, slug: 'Sample_Feature' }, entries: [entry()] },
      "feature.slug 'Sample_Feature' must be lowercase letters, digits and dashes.",
    );
  });

  it('rejects empty entries', () => {
    expectRejects(
      argsWith([]),
      "'entries' must be a non-empty array: the eighteen primer rows, then the standing tasks.",
    );
  });

  it('rejects more than 60 entries', () => {
    const entries = Array.from({ length: 61 }, (_, i) =>
      entry({ id: String(i + 1) }),
    );

    expectRejects(
      argsWith(entries),
      "'entries' holds 61 entries; the limit is 60.",
    );
  });

  it('rejects an entry that is not an object', () => {
    expectRejects(argsWith([entry(), 'x']), 'entries[2] must be an object.');
  });

  it('rejects an unknown group', () => {
    expectRejects(
      argsWith([entry({ group: 'extra' })]),
      "entries[1].group must be 'primer' or 'standing'.",
    );
  });

  it('rejects an unknown need', () => {
    expectRejects(
      argsWith([entry({ need: 'maybe' })]),
      "entries[1].need must be 'yes', 'no' or 'unclear'.",
    );
  });

  it('rejects missing items', () => {
    expectRejects(
      argsWith([entry({ items: undefined })]),
      'entries[1].items must list the work items as strings, two to six of them.',
    );
  });

  it('rejects more than 20 items', () => {
    const items = Array.from({ length: 21 }, (_, i) => `Item ${i + 1}`);

    expectRejects(
      argsWith([entry({ items })]),
      'entries[1].items holds 21 items; the limit is 20.',
    );
  });

  it('rejects a blank item', () => {
    expectRejects(
      argsWith([entry({ items: ['Add the record type', ' '] })]),
      'entries[1].items[2] must be a non-empty string.',
    );
  });

  it('rejects a blank task', () => {
    expectRejects(
      argsWith([entry({ task: '' })]),
      'entries[1].task is required and must be a non-empty string.',
    );
  });

  it('rejects a repeated id', () => {
    expectRejects(
      argsWith([entry(), entry({ task: 'Again' })]),
      "entries[2].id '1' repeats an earlier entry.",
    );
  });

  it('keeps an integer number and drops any other', () => {
    const primer = parsePrimer(
      argsWith([
        entry({ id: 'a', number: 4 }),
        entry({ id: 'b', number: 4.5 }),
        entry({ id: 'c', number: '4' }),
        entry({ id: 'd', number: true }),
      ]),
    );

    expect(primer.entries.map((each) => each.number)).toEqual([
      4,
      null,
      null,
      null,
    ]);
  });

  it('falls back to the task for a missing question', () => {
    const primer = parsePrimer(
      argsWith([
        entry({ id: 'a', task: ' Data model ' }),
        entry({ id: 'b', question: 'Does it save?' }),
      ]),
    );

    expect(entryOf(primer.entries, 'a').question).toBe('Data model');
    expect(entryOf(primer.entries, 'b').question).toBe('Does it save?');
  });
});

describe('readPrimerBody', () => {
  it("reads the user's need, comments and items back by id", () => {
    const primer = sample();
    const body = {
      feature: { ...primer.feature, notes: 'Ship it small.' },
      entries: [
        {
          id: '2',
          need: 'yes',
          comment: 'Only the main screen.',
          items: [
            { text: 'Draw the screen', include: true, comment: 'one pass' },
            { text: 'Wire its buttons', include: false },
            { text: ' Polish ', added: true },
          ],
        },
      ],
    };

    const read = readPrimerBody(primer, body);

    expect(read.feature.notes).toBe('Ship it small.');
    expect(entryOf(read.entries, '2')).toMatchObject({
      need: 'yes',
      comment: 'Only the main screen.',
      items: [
        {
          text: 'Draw the screen',
          include: true,
          comment: 'one pass',
          added: false,
        },
        { text: 'Wire its buttons', include: false, comment: '', added: false },
        { text: 'Polish', include: true, comment: '', added: true },
      ],
    });
    expect(entryOf(read.entries, '1')).toEqual(entryOf(primer.entries, '1'));
  });

  it("keeps the agent's question, evidence, probes and pointer whatever the body sends", () => {
    const primer = parsePrimer(
      argsWith([
        entry({
          question: 'Does it save?',
          evidence: 'spec §2',
          probes: 'save twice',
          pointer: 'src/save.ts',
        }),
      ]),
    );
    const sent = {
      id: '1',
      group: 'standing',
      number: 9,
      area: 'Elsewhere',
      question: 'Changed?',
      task: 'Changed task',
      evidence: 'none',
      probes: 'none',
      pointer: 'none',
    };

    const read = readPrimerBody(primer, { entries: [sent] });

    expect(read.entries).toEqual(primer.entries);
  });

  it('keeps the sent slug only when it matches the slug rule', () => {
    const primer = sample();

    const trimmed = readPrimerBody(primer, { feature: { slug: ' new-slug ' } });
    const refused = readPrimerBody(primer, { feature: { slug: 'New Slug' } });

    expect(trimmed.feature.slug).toBe('new-slug');
    expect(refused.feature.slug).toBe('sample-feature');
  });

  it('appends an extra entry once per id, needing yes by default', () => {
    const primer = sample();
    const extra = { id: 'x1', group: 'extra', task: ' Docs ' };

    const read = readPrimerBody(primer, {
      entries: [
        extra,
        { ...extra, task: 'Docs again' },
        {
          id: 'x2',
          group: 'extra',
          task: 'Release',
          need: 'no',
          comment: 'later',
        },
        { id: '3', group: 'extra', task: 'Not new' },
      ],
    });

    expect(read.entries.map((each) => each.id)).toEqual([
      '1',
      '2',
      '3',
      'tests',
      'x1',
      'x2',
    ]);
    expect(entryOf(read.entries, 'x1')).toEqual({
      id: 'x1',
      group: 'extra',
      number: null,
      area: '',
      question: 'Docs',
      task: 'Docs',
      need: 'yes',
      evidence: '',
      probes: '',
      pointer: '',
      comment: '',
      items: [],
    });
    expect(entryOf(read.entries, 'x2')).toMatchObject({
      need: 'no',
      comment: 'later',
    });
  });

  it('skips blank and malformed items and keeps the first 20', () => {
    const primer = sample();
    const many = Array.from({ length: 22 }, (_, i) => ({
      text: `Item ${i + 1}`,
    }));

    const malformed = readPrimerBody(primer, {
      entries: [
        {
          id: '1',
          items: ['plain', null, { text: '  ' }, { text: 7 }, { text: 'Kept' }],
        },
      ],
    });
    const capped = readPrimerBody(primer, {
      entries: [{ id: '1', items: many }],
    });

    expect(entryOf(malformed.entries, '1').items).toEqual([
      { text: 'Kept', include: true, comment: '', added: false },
    ]);
    expect(entryOf(capped.entries, '1').items.map((item) => item.text)).toEqual(
      many.slice(0, 20).map((item) => item.text),
    );
  });

  it("keeps the primer's values for a body that is not an object", () => {
    const primer = sample();

    expect(readPrimerBody(primer, 'oops')).toEqual(primer);
    expect(readPrimerBody(primer, { feature: 3, entries: 'none' })).toEqual(
      primer,
    );
  });
});

describe('primerPayload', () => {
  // The sample with one entry comment and one item comment.
  function commentedBody(primer: Primer): PrimerBody {
    const body = readPrimerBody(primer, {});
    const [first, second] = body.entries;
    first.comment = 'Keep it small.';
    second.items[0].comment = 'Only the main screen.';
    return body;
  }

  it('counts needs and comments in the summary', () => {
    const primer = sample();

    const payload = primerPayload(primer, 'submitted', commentedBody(primer));

    expect(payload.summary).toBe(
      '4 entries: 2 yes, 1 unclear, 1 no; 2 comments.',
    );
    expect(payload.next).toBe('');
    expect(payload.feature).toEqual(primer.feature);
    expect(entryOf(payload.entries, '1').comment).toBe('Keep it small.');
  });

  it("marks a draft's summary still open", () => {
    const primer = sample();

    const payload = primerPayload(primer, 'draft', readPrimerBody(primer, {}));

    expect(payload.summary).toBe(
      '4 entries: 2 yes, 1 unclear, 1 no; 0 comments. The form is still open.',
    );
  });

  it('pins the draft and cancelled next texts', () => {
    const primer = sample();
    const body = readPrimerBody(primer, {});

    expect(primerPayload(primer, 'draft', body).next).toBe(
      'The user has not submitted yet. Call collect_last_primer to keep waiting. Do not open a second primer.',
    );
    expect(primerPayload(primer, 'cancelled', body).next).toBe(
      'The user cancelled the primer. Write nothing, and ask the user how to proceed.',
    );
  });
});

describe('primerFingerprint', () => {
  it('gives the same fingerprint for a re-send and another for a changed item', () => {
    const changed = structuredClone(SAMPLE_PRIMER_ARGS);
    changed.entries[0].items = ['Add the record type', 'Save it elsewhere'];

    expect(primerFingerprint(sample())).toBe(primerFingerprint(sample()));
    expect(primerFingerprint(parsePrimer(changed))).not.toBe(
      primerFingerprint(sample()),
    );
  });

  it('ignores feature notes in the fingerprint', () => {
    const primer = sample();
    const noted = {
      ...primer,
      feature: { ...primer.feature, notes: 'Later.' },
    };

    expect(primerFingerprint(noted)).toBe(primerFingerprint(primer));
  });
});

describe('savedPrimerHeading', () => {
  it('reads the heading of saved args, and null without a feature name', () => {
    expect(savedPrimerHeading({ feature: { name: ' Sample feature ' } })).toBe(
      'Sample feature',
    );
    expect(savedPrimerHeading({ feature: { name: '  ' } })).toBeNull();
    expect(savedPrimerHeading({ feature: 'Sample feature' })).toBeNull();
    expect(savedPrimerHeading(null)).toBeNull();
  });
});

describe('the other payloads', () => {
  it('builds no_primer with no feature and no entries', () => {
    expect(noPrimerPayload()).toEqual({
      outcome: 'no_primer',
      summary: 'No primer is open.',
      next:
        'No primer is open for this session, and no finished answers are ' +
        'waiting for it. If you sent a primer whose answers you never ' +
        'received, send the same primer again with open_primer: the ' +
        "user's saved answers fill in. Do not move the questions into the " +
        'reply.',
    });
  });

  it('pins the hand-back and not-shown texts', () => {
    const primer = sample();

    const handedBack = primerHandedBackPayload(
      primer,
      'submitted',
      readPrimerBody(primer, {}),
    );
    const blocked = primerNotShownPayload(primer, 'Other feature');
    const unnamed = primerNotShownPayload(primer, null);

    expect(handedBack.next).toBe(
      "These answers are for an earlier primer, 'Sample feature', that you " +
        "never received. Read them as that primer's answers. The primer you " +
        'just sent was not opened: send it again with open_primer.',
    );
    expect(handedBack.earlier_heading).toBe('Sample feature');
    expect(blocked.outcome).toBe('draft');
    expect(blocked.summary).toBe(
      "This primer, 'Sample feature', was not shown: the primer 'Other " +
        "feature' is still open in the app.",
    );
    expect(blocked.next).toBe(
      "The user has not finished the primer 'Other feature' in the app, so " +
        'this primer was not opened and has no answers. Send this primer ' +
        'again with open_primer, and again after every draft like this one. ' +
        "Once the user finishes the primer 'Other feature', a send may " +
        "return that primer's answers instead, marked with earlier_heading: " +
        'act on them, then send this primer again. If the primer ' +
        "'Other feature' is no longer needed, ask the user to cancel it in " +
        'the app. Do not call collect_last_primer for this primer: that ' +
        "returns the other primer's answers.",
    );
    expect(blocked.entries).toEqual(primer.entries);
    expect(unnamed.summary).toBe(
      "This primer, 'Sample feature', was not shown: another primer is still open in the app.",
    );
  });
});
