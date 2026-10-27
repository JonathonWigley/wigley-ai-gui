import { describe, expect, it } from 'vitest';
import type { SessionControl } from '../../../contracts/agent';
import {
  choiceRowInput,
  controlRowInput,
  folderRowInput,
  profileRowInput,
  sessionRowInput,
} from './picker-row';

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
      input: folderRowInput({
        kind: 'recent',
        folder: { projectDir: '/home/me/repo', profile: 'work', lastUsed: 7 },
        label: '~/repo',
      }),
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
      input: folderRowInput({ kind: 'choose', label: 'Choose folder…' }),
      expected: { list: 'folder', kind: 'choose' },
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
      input: sessionRowInput({ kind: 'new', label: 'New session' }),
      expected: { list: 'session', kind: 'new' },
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
