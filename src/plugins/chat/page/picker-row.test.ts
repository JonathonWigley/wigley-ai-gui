import { describe, expect, it } from 'vitest';
import type { SessionControl } from '../../../contracts/agent';
import { posixPaths } from '../../../shared/paths/posix-paths';
import {
  choiceRowInput,
  controlRowInput,
  folderRowInput,
  profileRowInput,
  sessionRowInput,
} from './picker-row';
import { sessionTime } from './resume-items';

const AT = new Date(2026, 0, 2, 3, 4).getTime();
const closed = {
  hostSessionId: 'h2',
  projectDir: '/home/me/repo',
  profile: 'work',
  title: 'Fix login',
  at: AT,
};

const mode: SessionControl = {
  id: 'mode',
  label: 'Mode',
  choices: [
    { value: 'plan', label: 'Plan' },
    { value: 'auto', label: 'Auto' },
  ],
  value: 'auto',
};

describe('picker row inputs', () => {
  it.each([
    {
      row: 'a recent folder',
      input: folderRowInput(
        {
          kind: 'recent',
          folder: { projectDir: '/home/me/repo', profile: 'work', lastUsed: 7 },
          label: '~/repo',
        },
        posixPaths,
      ),
      expected: {
        list: 'folder',
        kind: 'recent',
        path: '~/repo',
        profile: 'work',
        lastUsed: 7,
      },
    },
    {
      row: 'the choose line',
      input: folderRowInput(
        { kind: 'choose', label: 'Choose folder…' },
        posixPaths,
      ),
      expected: { list: 'folder', kind: 'choose' },
    },
    {
      row: 'a folder section row',
      input: folderRowInput(
        {
          kind: 'section',
          section: 'Recently closed',
          row: closed,
          label: 'Fix login · repo · work · time',
        },
        posixPaths,
      ),
      expected: {
        list: 'folder',
        kind: 'section',
        title: 'Fix login',
        detail: `repo · work · ${sessionTime(AT)}`,
        at: AT,
      },
    },
    {
      row: 'a folder section row with a note',
      input: folderRowInput(
        {
          kind: 'section',
          section: 'Stashed',
          row: { ...closed, note: 'after lunch' },
          label: 'Fix login · after lunch · repo · work · time',
        },
        posixPaths,
      ),
      expected: {
        list: 'folder',
        kind: 'section',
        title: 'Fix login',
        detail: `after lunch · repo · work · ${sessionTime(AT)}`,
        at: AT,
      },
    },
    {
      row: 'a profile',
      input: profileRowInput({ name: 'work', configDir: '/home/me/.claude' }),
      expected: {
        list: 'profile',
        name: 'work',
        configDir: '/home/me/.claude',
      },
    },
    {
      row: 'the new-session line',
      input: sessionRowInput({
        kind: 'new',
        label: 'New session',
      }),
      expected: { list: 'session', kind: 'new' },
    },
    {
      row: 'a session section row',
      input: sessionRowInput({
        kind: 'section',
        section: 'Recently closed',
        row: {
          hostSessionId: 'h2',
          title: 'first message',
          modified: 9,
          archived: false,
        },
        closed,
        label: 'Fix login · time',
      }),
      expected: {
        list: 'session',
        kind: 'section',
        title: 'Fix login',
        detail: sessionTime(AT),
        at: AT,
      },
    },
    {
      row: 'a session section row with a note',
      input: sessionRowInput({
        kind: 'section',
        section: 'Stashed',
        row: {
          hostSessionId: 'h2',
          title: 'first message',
          modified: 9,
          archived: false,
        },
        closed: { ...closed, note: 'after lunch' },
        label: 'Fix login · after lunch · time',
      }),
      expected: {
        list: 'session',
        kind: 'section',
        title: 'Fix login',
        detail: `after lunch · ${sessionTime(AT)}`,
        at: AT,
      },
    },
    {
      row: 'a past session archived',
      input: sessionRowInput({
        kind: 'past',
        row: {
          hostSessionId: 'h1',
          title: 'Fix it',
          modified: 9,
          archived: true,
        },
        label: 'Fix it · archived',
      }),
      expected: {
        list: 'session',
        kind: 'past',
        title: 'Fix it',
        modified: 9,
        archived: true,
      },
    },
    {
      row: 'a control',
      input: controlRowInput(mode),
      expected: { list: 'controls', label: 'Mode', value: 'Auto' },
    },
    {
      row: 'the current choice',
      input: choiceRowInput(mode.choices[1], mode),
      expected: { list: 'choices', label: 'Auto', isCurrent: true },
    },
    {
      row: 'another choice',
      input: choiceRowInput(mode.choices[0], mode),
      expected: { list: 'choices', label: 'Plan', isCurrent: false },
    },
  ])('rowInput_EachList_MapsItsFields ($row)', ({ input, expected }) => {
    expect(input).toEqual(expected);
  });
});
