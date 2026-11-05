import { describe, expect, it } from 'vitest';
import { fakeFuzzyMatcher } from '../../../shared/fake-fuzzy-matcher.test-support';
import type { CommandRow } from './keymap-rows';
import { matchesCommand, matchesLeader, matchesSetting } from './row-filter';
import type { SettingRow } from './setting-rows';

function settingRow(fields: {
  label: string;
  path: string;
  description: string;
}): SettingRow {
  return {
    leaf: fields,
    value: undefined,
    isSet: false,
  } as unknown as SettingRow;
}

const setting = settingRow({
  label: 'Key sequence',
  path: 'core.timeoutMs',
  description: 'A transparent wait',
});

describe('matchesSetting', () => {
  it.each([
    { given: 'its label', query: 'kys' },
    { given: 'its path', query: 'cor.tm' },
  ])('matchesSetting_FuzzyLabel_Matches through $given', ({ query }) => {
    expect(matchesSetting(setting, query, fakeFuzzyMatcher)).toBe(true);
  });

  it.each([
    { query: 'tpt', isMatch: false },
    { query: ' TRANSPARENT ', isMatch: true },
    { query: '   ', isMatch: true },
  ])(
    'matchesSetting_DescriptionIsSubstringOnly "$query" → $isMatch',
    ({ query, isMatch }) => {
      expect(matchesSetting(setting, query, fakeFuzzyMatcher)).toBe(isMatch);
    },
  );
});

describe('matchesCommand', () => {
  const row = {
    command: {
      id: 'core.showSessions',
      plugin: 'core',
      label: 'Show sessions',
      group: 'g',
      runsIn: 'page',
    },
    binds: [{ bind: { keys: '<Leader>ks' } }],
    accelerators: [
      { kind: 'app', bind: { accelerator: 'Cmd+P' } },
      { kind: 'intercept', bind: { key: 'Alt+Q' } },
    ],
  } as unknown as CommandRow;

  it.each([
    { given: 'its label', query: 'w s', isMatch: true },
    { given: 'its id', query: '.sh', isMatch: true },
    { given: "a line's keys", query: '<lks', isMatch: true },
    { given: 'an accelerator', query: 'c+p', isMatch: true },
    { given: 'an intercept key', query: 'a+q', isMatch: true },
    { given: 'nothing', query: 'zzz', isMatch: false },
    { given: 'only spaces', query: '   ', isMatch: true },
  ])(
    'matchesCommand_FuzzyKeys_Matches through $given → $isMatch',
    ({ query, isMatch }) => {
      expect(matchesCommand(row, query, fakeFuzzyMatcher)).toBe(isMatch);
    },
  );
});

describe('matchesLeader', () => {
  it.each([
    { given: 'the word', query: 'ldr', isMatch: true },
    { given: 'a key', query: 'spc', isMatch: true },
    { given: 'nothing', query: 'zzz', isMatch: false },
    { given: 'only spaces', query: '   ', isMatch: true },
  ])(
    'matchesLeader_WordOrKey_Matches through $given → $isMatch',
    ({ query, isMatch }) => {
      expect(matchesLeader(['<Space>'], query, fakeFuzzyMatcher)).toBe(isMatch);
    },
  );
});
