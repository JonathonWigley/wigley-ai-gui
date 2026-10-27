import { describe, expect, it } from 'vitest';
import { parsePrimer } from '../primer';
import { PREVIEW_PRIMER_ARGS } from './preview-primer';

describe('PREVIEW_PRIMER_ARGS', () => {
  it('PREVIEW_PRIMER_ARGS parses, and holds every need, both agent groups and every card section', () => {
    const { entries } = parsePrimer(PREVIEW_PRIMER_ARGS);
    const isNotBlank = (text: string) => text.trim() !== '';

    expect(new Set(entries.map((entry) => entry.need))).toEqual(
      new Set(['yes', 'no', 'unclear']),
    );
    expect(new Set(entries.map((entry) => entry.group))).toEqual(
      new Set(['primer', 'standing']),
    );
    expect(
      entries.some(
        (entry) =>
          isNotBlank(entry.question) &&
          isNotBlank(entry.evidence) &&
          isNotBlank(entry.probes) &&
          isNotBlank(entry.pointer),
      ),
    ).toBe(true);
  });
});
