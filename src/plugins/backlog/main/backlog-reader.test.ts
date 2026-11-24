import { describe, expect, it } from 'vitest';
import type { BacklogContribution } from '../../../contracts/contributions';
import type {
  ContributionSource,
  ReadResult,
} from '../../contributions/contract';
import { backlogReader } from './backlog-reader';

const SOURCE: ContributionSource = {
  pluginName: 'acme',
  pluginKey: 'acme@market',
  version: '1.0.0',
  root: '/plugins/acme',
  harnessId: 'fake',
};

const SECTION: BacklogContribution = {
  label: 'Acme backlog',
  homes: ['{repo}/docs/features', '~/wigley-features/{name}'],
  file: 'followups.md',
  areaFolder: 'followups',
  assistant: { instructions: 'Tag each item.' },
};

const refused = (...reasons: string[]): ReadResult<BacklogContribution> => ({
  ok: false,
  reasons,
});

const neither = (index: number, template: string) =>
  `homes[${index}]: "${template}" is neither {repo}/<folder> nor <folder>/{name}`;

describe('backlogReader', () => {
  it.each<{
    case: string;
    section: unknown;
    expected: ReadResult<BacklogContribution>;
  }>([
    {
      case: "the user's section",
      section: SECTION,
      expected: { ok: true, value: SECTION },
    },
    {
      case: 'only the required keys, an extra key dropped',
      section: { homes: ['{repo}/notes'], file: 'todo.md', model: 'big' },
      expected: {
        ok: true,
        value: { homes: ['{repo}/notes'], file: 'todo.md' },
      },
    },
    {
      case: 'an array',
      section: [SECTION],
      expected: refused('"backlog" is not an object'),
    },
    {
      case: 'no homes',
      section: { ...SECTION, homes: undefined },
      expected: refused('homes: not a list of folder templates'),
    },
    {
      case: 'empty homes',
      section: { ...SECTION, homes: [] },
      expected: refused('homes: not a list of folder templates'),
    },
    {
      case: 'a home that is not a string',
      section: { ...SECTION, homes: ['{repo}/docs/features', 3] },
      expected: refused('homes: not a list of folder templates'),
    },
    ...[
      'docs/features',
      '{repo}/../x',
      '{repo}/{name}',
      'wigley-features/{name}',
      '~/x/{name}/y',
    ].map((template) => ({
      case: `the template ${template}`,
      section: { ...SECTION, homes: ['{repo}/docs/features', template] },
      expected: refused(neither(1, template)),
    })),
    {
      case: 'no file',
      section: { ...SECTION, file: undefined },
      expected: refused('file: not a .md file name'),
    },
    {
      case: 'a file that is not .md',
      section: { ...SECTION, file: 'followups.txt' },
      expected: refused('file: not a .md file name'),
    },
    {
      case: 'a file with a folder',
      section: { ...SECTION, file: 'notes/followups.md' },
      expected: refused('file: not a .md file name'),
    },
    {
      case: 'a file with a backslash',
      section: { ...SECTION, file: 'notes\\followups.md' },
      expected: refused('file: not a .md file name'),
    },
    {
      case: 'an empty areaFolder',
      section: { ...SECTION, areaFolder: '' },
      expected: refused('areaFolder: not a folder name'),
    },
    {
      case: 'an areaFolder with a folder',
      section: { ...SECTION, areaFolder: 'a/b' },
      expected: refused('areaFolder: not a folder name'),
    },
    {
      case: 'an assistant with no instructions',
      section: { ...SECTION, assistant: { instructions: '' } },
      expected: refused('assistant: not { "instructions": text }'),
    },
    {
      case: 'an assistant that is text',
      section: { ...SECTION, assistant: 'Tag each item.' },
      expected: refused('assistant: not { "instructions": text }'),
    },
    {
      case: 'a label that is not a string',
      section: { ...SECTION, label: 7 },
      expected: refused('label: not a string'),
    },
    {
      case: 'every reason at once',
      section: {
        label: 7,
        homes: ['x'],
        file: 'a',
        areaFolder: '',
        assistant: {},
      },
      expected: refused(
        neither(0, 'x'),
        'file: not a .md file name',
        'areaFolder: not a folder name',
        'assistant: not { "instructions": text }',
        'label: not a string',
      ),
    },
  ])('read_Sections_ValueOrEachReason ($case)', ({ section, expected }) => {
    expect(backlogReader.read(section, SOURCE)).toEqual(expected);
  });
});
