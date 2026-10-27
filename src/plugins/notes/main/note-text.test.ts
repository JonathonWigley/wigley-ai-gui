import { describe, expect, it } from 'vitest';
import type { NoteFields } from '../contract';
import { firstSentence, followupText, launchText } from './note-text';

const FIELDS: NoteFields = {
  target: '/r/docs/features',
  targetPicked: false,
  title: 'Save hint',
  body: 'The hint sits low.',
  tags: [],
  session: null,
  fresh: false,
};
const LINE = 'Source session: Claude Code abc in ~/r';

describe('firstSentence', () => {
  it.each([
    [
      'The save button is misaligned. It sits 2px low.',
      'The save button is misaligned.',
    ],
    ['Is this wrong? Yes.', 'Is this wrong?'],
    ['Version 1.2 is out. Next', 'Version 1.2 is out.'],
    ['Line one\nline two. More', 'Line one line two.'],
    ['No full stop here', 'No full stop here'],
    ['First para\n\nSecond para.', 'First para'],
    ['  ', ''],
  ])('firstSentence_%j_%j', (body, expected) => {
    expect(firstSentence(body)).toBe(expected);
  });

  it('firstSentence_WhitespaceOnlyLine_EndsParagraph', () => {
    expect(firstSentence('First para\n  \t\nSecond.')).toBe('First para');
  });
});

describe('followupText', () => {
  it('followupText_Create_BodyAndLineWithoutTitle', () => {
    expect(followupText(FIELDS, LINE, 'create')).toBe(
      `The hint sits low.\n\n${LINE}`,
    );
  });

  it('followupText_Append_TitleBodyAndLine', () => {
    expect(followupText(FIELDS, LINE, 'append')).toBe(
      `Save hint\n\nThe hint sits low.\n\n${LINE}`,
    );
  });

  it('followupText_NoLine_BodyAlone', () => {
    expect(followupText(FIELDS, null, 'create')).toBe('The hint sits low.');
    expect(followupText(FIELDS, null, 'append')).toBe(
      'Save hint\n\nThe hint sits low.',
    );
  });

  it('followupText_EmptyBody_PartLeftOut', () => {
    const fields = { ...FIELDS, body: '  ' };
    expect(followupText(fields, LINE, 'create')).toBe(LINE);
    expect(followupText(fields, LINE, 'append')).toBe(`Save hint\n\n${LINE}`);
  });
});

describe('launchText', () => {
  const BRIEF =
    'A nitpick to fix, noted while working. Make the change, then report.';

  it('launchText_AllParts_BriefTitleBodyLine', () => {
    expect(launchText(BRIEF, FIELDS, LINE)).toBe(
      `${BRIEF}\n\nSave hint\n\nThe hint sits low.\n\nSource session: Claude Code abc in ~/r`,
    );
  });

  it('launchText_EmptyTitle_TitleLeftOut', () => {
    expect(launchText(BRIEF, { ...FIELDS, title: '' }, LINE)).toBe(
      `${BRIEF}\n\nThe hint sits low.\n\n${LINE}`,
    );
  });
});
