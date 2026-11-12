import { describe, expect, it } from 'vitest';
import {
  MAX_PRIMER_ENTRIES,
  MAX_PRIMER_ITEMS,
  type Primer,
  type PrimerBody,
  type PrimerEntry,
} from '../contract';
import { SAMPLE_PRIMER_ARGS } from './fixtures';
import {
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

describe('parsePrimer', () => {
  it("parses the sample into a primer with blank comments, a no row's items left out", () => {
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
          include: false,
          comment: '',
          added: false,
        },
      ],
    });
    expect(entryOf(primer.entries, 'tests').group).toBe('standing');
  });

  it.each([
    { need: 'yes', include: true },
    { need: 'unclear', include: true },
    { need: 'no', include: false },
  ])("opens a $need row's items with include $include", ({ need, include }) => {
    const primer = parsePrimer(
      argsWith([entry({ need, items: ['Add the record type', 'Save it'] })]),
    );

    expect(primer.entries[0].items.map((item) => item.include)).toEqual([
      include,
      include,
    ]);
  });

  it.each([
    { case: 'args that are not an object', args: ['feature'], names: null },
    {
      case: 'a missing feature',
      args: { entries: [entry()] },
      names: 'feature',
    },
    {
      case: 'a blank feature name',
      args: { feature: { ...FEATURE, name: '  ' }, entries: [entry()] },
      names: 'feature.name',
    },
    {
      case: 'a slug outside the slug rule',
      args: {
        feature: { ...FEATURE, slug: 'Sample_Feature' },
        entries: [entry()],
      },
      names: 'Sample_Feature',
    },
    { case: 'empty entries', args: argsWith([]), names: 'entries' },
    {
      case: 'one entry past the cap',
      args: argsWith(
        Array.from({ length: MAX_PRIMER_ENTRIES + 1 }, (_, i) =>
          entry({ id: String(i + 1) }),
        ),
      ),
      names: String(MAX_PRIMER_ENTRIES + 1),
    },
    {
      case: 'an entry that is not an object',
      args: argsWith([entry(), 'x']),
      names: 'entries[2]',
    },
    {
      case: 'an unknown group',
      args: argsWith([entry({ group: 'extra' })]),
      names: 'entries[1].group',
    },
    {
      case: 'an unknown need',
      args: argsWith([entry({ need: 'maybe' })]),
      names: 'entries[1].need',
    },
    {
      case: 'missing items',
      args: argsWith([entry({ items: undefined })]),
      names: 'entries[1].items',
    },
    {
      case: 'one item past the cap',
      args: argsWith([
        entry({
          items: Array.from(
            { length: MAX_PRIMER_ITEMS + 1 },
            (_, i) => `Item ${i + 1}`,
          ),
        }),
      ]),
      names: String(MAX_PRIMER_ITEMS + 1),
    },
    {
      case: 'a blank item',
      args: argsWith([entry({ items: ['Add the record type', ' '] })]),
      names: 'entries[1].items[2]',
    },
    {
      case: 'a blank task',
      args: argsWith([entry({ task: '' })]),
      names: 'entries[1].task',
    },
    {
      case: 'a repeated id',
      args: argsWith([entry(), entry({ task: 'Again' })]),
      names: 'entries[2].id',
    },
  ])('rejects $case, naming what it got wrong', ({ args, names }) => {
    expect(() => parsePrimer(args)).toThrow(PrimerError);
    if (names !== null) {
      expect(() => parsePrimer(args)).toThrow(names);
    }
  });

  it.each([
    {
      case: 'entries at the cap',
      args: argsWith(
        Array.from({ length: MAX_PRIMER_ENTRIES }, (_, i) =>
          entry({ id: String(i + 1) }),
        ),
      ),
      entries: MAX_PRIMER_ENTRIES,
      firstItems: 1,
    },
    {
      case: 'items at the cap',
      args: argsWith([
        entry({
          items: Array.from(
            { length: MAX_PRIMER_ITEMS },
            (_, i) => `Item ${i + 1}`,
          ),
        }),
      ]),
      entries: 1,
      firstItems: MAX_PRIMER_ITEMS,
    },
  ])('accepts $case', ({ args, entries, firstItems }) => {
    const primer = parsePrimer(args);

    expect(primer.entries).toHaveLength(entries);
    expect(primer.entries[0].items).toHaveLength(firstItems);
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

  it("keeps a no row's saved include, and its parsed one when the body sends no items", () => {
    const primer = sample();
    const ticked = {
      id: '3',
      items: [{ text: 'Add the sound cues', include: true }],
    };

    const read = readPrimerBody(primer, { entries: [ticked] });
    const unsent = readPrimerBody(primer, { entries: [{ id: '3' }] });

    expect(entryOf(read.entries, '3').items[0].include).toBe(true);
    expect(entryOf(unsent.entries, '3').items[0].include).toBe(false);
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

    expect(payload.summary).toMatch(
      /4 entries\D+2 yes\D+1 unclear\D+1 no\D+2 comments/,
    );
    expect(payload.next).toBe('');
    expect(payload.feature).toEqual(primer.feature);
    expect(entryOf(payload.entries, '1').comment).toBe('Keep it small.');
  });

  it("marks a draft's summary still open", () => {
    const primer = sample();

    const body = readPrimerBody(primer, {});

    const draft = primerPayload(primer, 'draft', body);
    const submitted = primerPayload(primer, 'submitted', body);

    expect(draft.summary).toMatch(/4 entries.*0 comments/);
    expect(draft.summary).not.toBe(submitted.summary);
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
  it('names the earlier primer it hands back, and the primer that blocks one, when it has a name', () => {
    const primer = sample();

    const handedBack = primerHandedBackPayload(
      primer,
      'submitted',
      readPrimerBody(primer, {}),
    );
    const blocked = primerNotShownPayload(primer, 'Other feature');
    const unnamed = primerNotShownPayload(primer, null);

    expect(handedBack.earlier_heading).toBe('Sample feature');
    expect(handedBack.next).toContain("'Sample feature'");
    expect(blocked.outcome).toBe('draft');
    expect(blocked.entries).toEqual(primer.entries);
    expect(blocked.summary).toContain("'Sample feature'");
    expect(blocked.summary).toContain("'Other feature'");
    expect(blocked.next).toContain("'Other feature'");
    expect(unnamed.summary).toContain("'Sample feature'");
    expect(unnamed.summary).not.toBe(blocked.summary);
    expect(`${unnamed.summary} ${unnamed.next}`).not.toContain('null');
  });
});
