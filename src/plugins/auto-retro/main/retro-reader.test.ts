import { describe, expect, it } from 'vitest';
import type { RetroContribution } from '../../../contracts/contributions';
import type {
  ContributionSource,
  ReadResult,
} from '../../contributions/contract';
import { retroReader } from './retro-reader';

const SOURCE: ContributionSource = {
  pluginName: 'acme',
  pluginKey: 'acme@market',
  version: '1.0.0',
  root: '/plugins/acme',
  harnessId: 'fake',
};

const SECTION: RetroContribution = {
  command: '/wigley:retro auto {sessions}',
  folder: '~/wigley-agents',
  on: ['close', 'clear'],
};

const refused = (...reasons: string[]): ReadResult<RetroContribution> => ({
  ok: false,
  reasons,
});

describe('retroReader', () => {
  it.each<{
    case: string;
    section: unknown;
    expected: ReadResult<RetroContribution>;
  }>([
    {
      case: "the user's section",
      section: SECTION,
      expected: { ok: true, value: SECTION },
    },
    {
      case: 'a label is kept',
      section: { ...SECTION, label: 'Acme retro' },
      expected: { ok: true, value: { ...SECTION, label: 'Acme retro' } },
    },
    {
      case: 'an extra key is dropped',
      section: { ...SECTION, model: 'big' },
      expected: { ok: true, value: SECTION },
    },
    {
      case: 'an array',
      section: [SECTION],
      expected: refused('"retro" is not an object'),
    },
    {
      case: 'no command',
      section: { folder: SECTION.folder, on: SECTION.on },
      expected: refused('command: not a non-empty string'),
    },
    {
      case: 'an empty command',
      section: { ...SECTION, command: '' },
      expected: refused('command: not a non-empty string'),
    },
    {
      case: 'a command without {sessions}',
      section: { ...SECTION, command: '/acme:retro' },
      expected: refused('command: holds {sessions} 0 times, not once'),
    },
    {
      case: 'a command with {sessions} twice',
      section: { ...SECTION, command: '/acme:retro {sessions} {sessions}' },
      expected: refused('command: holds {sessions} 2 times, not once'),
    },
    {
      case: 'a command with only space before {sessions}',
      section: { ...SECTION, command: '  {sessions} --quiet' },
      expected: refused('command: has no text before {sessions}'),
    },
    {
      case: 'an empty folder',
      section: { ...SECTION, folder: '' },
      expected: refused('folder: not a non-empty string'),
    },
    {
      case: 'an empty on',
      section: { ...SECTION, on: [] },
      expected: refused('on: not a list of close and clear'),
    },
    {
      case: 'an unknown ending in on',
      section: { ...SECTION, on: ['close', 'quit'] },
      expected: refused('on: not a list of close and clear'),
    },
    {
      case: 'a repeated ending in on',
      section: { ...SECTION, on: ['clear', 'clear'] },
      expected: refused('on: not a list of close and clear'),
    },
    {
      case: 'on as a string',
      section: { ...SECTION, on: 'close' },
      expected: refused('on: not a list of close and clear'),
    },
    {
      case: 'a label that is no string',
      section: { ...SECTION, label: 3 },
      expected: refused('label: not a string'),
    },
    {
      case: 'every field wrong, reasons in field order',
      section: { command: 5, folder: null, on: [], label: false },
      expected: refused(
        'command: not a non-empty string',
        'folder: not a non-empty string',
        'on: not a list of close and clear',
        'label: not a string',
      ),
    },
  ])('retroReader_ReadsTheSection: $case', ({ section, expected }) => {
    expect(retroReader.read(section, SOURCE)).toEqual(expected);
  });
});
