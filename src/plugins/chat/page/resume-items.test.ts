import { describe, expect, it } from 'vitest';
import { posixPaths } from '../../../shared/paths/posix-paths';
import { windowsPaths } from '../../../shared/paths/windows-paths';
import type {
  PastSessionRow,
  ResumeSectionRow,
  ResumeSectionRows,
} from '../contract';
import {
  archiveStateOf,
  type SessionItem,
  SESSIONS_HEADING,
  selectedAfterChange,
  sessionItems,
  sessionSection,
  sessionTime,
  withArchived,
} from './resume-items';

const MODIFIED = new Date(2026, 0, 2, 3, 4).getTime();

function row(
  hostSessionId: string,
  title: string,
  archived: boolean,
): PastSessionRow {
  return { hostSessionId, title, modified: MODIFIED, archived };
}

const a = row('a', 'alpha', false);
const b = row('b', 'beta', true);
const c = row('c', 'gamma', false);

const newItem: SessionItem = { kind: 'new', label: 'New session' };

function past(pastRow: PastSessionRow): SessionItem {
  return { kind: 'past', row: pastRow, label: pastRow.title };
}

const STEP = { projectDir: '/Users/u/dev/app', profile: 'work' };

function closedRow(
  hostSessionId: string,
  changes: Partial<ResumeSectionRow> = {},
): ResumeSectionRow {
  return {
    hostSessionId,
    projectDir: STEP.projectDir,
    profile: STEP.profile,
    title: `closed ${hostSessionId}`,
    at: MODIFIED,
    ...changes,
  };
}

function inSection(pastRow: PastSessionRow): SessionItem {
  return {
    kind: 'section',
    section: 'Recently closed',
    row: pastRow,
    closed: closedRow(pastRow.hostSessionId),
    label: pastRow.title,
  };
}

describe('resume items', () => {
  it('sessionTime_LocalFieldsZeroPadded', () => {
    expect(sessionTime(new Date(2026, 9, 20, 9, 5).getTime())).toBe(
      '2026-10-20 09:05',
    );
  });

  it('sessionItems_NewFirstArchivedOnlyWhenShown', () => {
    const ids = (showArchived: boolean) =>
      sessionItems([a, b], [], STEP, posixPaths, showArchived).map((item) =>
        item.kind === 'past' ? item.row.hostSessionId : item.kind,
      );
    expect(ids(false)).toEqual(['new', 'a']);
    expect(ids(true)).toEqual(['new', 'a', 'b']);
  });

  it.each<{
    given: string;
    sections: ResumeSectionRows[];
    step?: { projectDir: string; profile: string };
    paths?: typeof posixPaths;
    showArchived?: boolean;
    lines: string[];
  }>([
    {
      given: 'rows of the step, in the order given',
      sections: [
        {
          title: 'Recently closed',
          rows: [closedRow('c'), closedRow('a')],
        },
      ],
      lines: ['Recently closed:c', 'Recently closed:a', 'new'],
    },
    {
      given: 'the step folder spelled another way',
      sections: [
        {
          title: 'Recently closed',
          rows: [closedRow('a', { projectDir: 'C:\\Dev\\App' })],
        },
      ],
      step: { projectDir: 'c:\\dev\\app\\', profile: 'work' },
      paths: windowsPaths,
      lines: ['Recently closed:a', 'new', 'c'],
    },
    {
      given: 'a row of another folder',
      sections: [
        {
          title: 'Recently closed',
          rows: [closedRow('a', { projectDir: '/Users/u/dev/other' })],
        },
      ],
      lines: ['new', 'a', 'c'],
    },
    {
      given: 'a row of another profile',
      sections: [
        {
          title: 'Recently closed',
          rows: [closedRow('a', { profile: 'personal' })],
        },
      ],
      lines: ['new', 'a', 'c'],
    },
    {
      given: 'a row with no saved session',
      sections: [{ title: 'Recently closed', rows: [closedRow('z')] }],
      lines: ['new', 'a', 'c'],
    },
    {
      given: 'an archived session, archived rows shown',
      sections: [{ title: 'Recently closed', rows: [closedRow('b')] }],
      showArchived: true,
      lines: ['new', 'a', 'b', 'c'],
    },
    {
      given: 'two sections holding one session',
      sections: [
        { title: 'Recently closed', rows: [closedRow('a')] },
        { title: 'Pinned', rows: [closedRow('a'), closedRow('c')] },
      ],
      lines: ['Recently closed:a', 'Pinned:c', 'new'],
    },
  ])(
    'sessionItems_SectionRows_ShowOnlyMatchingAndOnce given $given',
    ({ sections, step, paths, showArchived, lines }) => {
      const items = sessionItems(
        [a, b, c],
        sections,
        step ?? STEP,
        paths ?? posixPaths,
        showArchived ?? false,
      );

      expect(
        items.map((item) => {
          if (item.kind === 'new') {
            return 'new';
          }
          return item.kind === 'section'
            ? `${item.section}:${item.row.hostSessionId}`
            : item.row.hostSessionId;
        }),
      ).toEqual(lines);
    },
  );

  it.each([
    { given: 'no note', note: undefined, label: 'closed a · 2026-01-02 03:04' },
    {
      given: 'a note',
      note: 'after lunch',
      label: 'closed a · after lunch · 2026-01-02 03:04',
    },
  ])(
    'sessionItems_SectionRowNote_FollowsTitle given $given',
    ({ note, label }) => {
      const [item] = sessionItems(
        [a],
        [{ title: 'Stashed', rows: [closedRow('a', { note })] }],
        STEP,
        posixPaths,
        false,
      );

      expect(item.kind === 'section' ? item.label : null).toBe(label);
    },
  );

  it.each([
    {
      given: 'a section row',
      item: inSection(a),
      showsSections: true,
      heading: 'Recently closed',
    },
    {
      given: 'the new session line beside section rows',
      item: newItem,
      showsSections: true,
      heading: SESSIONS_HEADING,
    },
    {
      given: 'a past row beside section rows',
      item: past(a),
      showsSections: true,
      heading: SESSIONS_HEADING,
    },
    {
      given: 'the lone new session line',
      item: newItem,
      showsSections: false,
      heading: null,
    },
  ])(
    'sessionSection for $given → $heading',
    ({ item, showsSections, heading }) => {
      expect(sessionSection(item, showsSections)).toBe(heading);
    },
  );

  it('withArchived_CopiesWithTheFlagSet', () => {
    const rows = [a, b];
    const changed = withArchived(rows, 'b', false);
    expect(changed[1].archived).toBe(false);
    expect(changed[0]).toEqual(row('a', 'alpha', false));
    expect(rows[1].archived).toBe(true);
    expect(rows).toEqual([row('a', 'alpha', false), row('b', 'beta', true)]);
  });

  it('selectedAfterChange_SameItemNextOrLast', () => {
    const before = [newItem, past(a), past(b), past(c)];
    expect(selectedAfterChange(before, 1, [newItem, past(b), past(c)])).toBe(1);
    expect(selectedAfterChange(before, 3, [newItem, past(a), past(b)])).toBe(2);
    expect(selectedAfterChange(before, 2, before)).toBe(2);
    expect(selectedAfterChange(before, 0, before)).toBe(0);
    expect(selectedAfterChange(before, null, before)).toBe(0);
  });

  it('selectedAfterChange_ArchivedSectionRow_MovesToNextRow', () => {
    const s1 = inSection(a);
    const p1 = past(c);

    expect(selectedAfterChange([s1, newItem, p1], 0, [newItem, p1])).toBe(0);
    expect(
      selectedAfterChange([s1, inSection(c), newItem], 0, [
        inSection(c),
        newItem,
      ]),
    ).toBe(0);
    expect(selectedAfterChange([newItem, s1], 1, [newItem])).toBe(0);
    expect(selectedAfterChange([s1, newItem], 0, [newItem, past(a)])).toBe(1);
  });

  it('selectedAfterChange_OnNewLine_StaysOnNewLine', () => {
    const s1 = inSection(a);

    expect(selectedAfterChange([s1, newItem], 1, [s1, newItem])).toBe(1);
    expect(selectedAfterChange([s1, newItem], 1, [newItem, past(a)])).toBe(0);
    expect(selectedAfterChange([s1, newItem], null, [s1, newItem])).toBe(1);
  });

  it.each([
    { given: 'the new session line', item: newItem, expected: null },
    { given: 'a section row', item: inSection(a), expected: 'live' },
    { given: 'a live row', item: past(a), expected: 'live' },
    { given: 'an archived row', item: past(b), expected: 'archived' },
  ])('archiveStateOf $given → $expected', ({ item, expected }) => {
    expect(archiveStateOf(item)).toBe(expected);
  });
});
