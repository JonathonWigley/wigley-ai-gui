import { describe, expect, it } from 'vitest';
import type { AgentCommand } from '../../contracts/agent';
import {
  commandRecordsOf,
  mergeInitNames,
  withNameAfterPlugin,
} from './claude-commands';

const record = (
  name: string,
  aliases: string[] = [],
  description = `about ${name}`,
): AgentCommand => ({ name, description, argumentHint: '', aliases });

const emptyRecord = (name: string): AgentCommand => record(name, [], '');

describe('claude-commands', () => {
  it('commandRecordsOf_ReadsFields', () => {
    const records = commandRecordsOf({
      commands: [
        {
          name: 'wigley:feature',
          description: 'Plan a change',
          argumentHint: 'the change',
          aliases: ['feature'],
          builtin: true,
        },
        { name: '/compact', description: 12, argumentHint: null },
        { name: 'usage', aliases: ['/cost', 3] },
        {
          name: 'wigley:retro',
          description: '`backfill &lt;days&gt;` &amp; &amp;lt;more',
          argumentHint: '[backfill <days>]',
        },
        { description: 'no name' },
        'not a record',
      ],
    });

    expect(records).toEqual([
      {
        name: 'wigley:feature',
        description: 'Plan a change',
        argumentHint: 'the change',
        aliases: ['feature'],
      },
      { name: 'compact', description: '', argumentHint: '', aliases: [] },
      { name: 'usage', description: '', argumentHint: '', aliases: ['cost'] },
      {
        name: 'wigley:retro',
        description: '`backfill <days>` & &lt;more',
        argumentHint: '[backfill <days>]',
        aliases: [],
      },
    ]);
  });

  it.each<{ case: string; reply: Record<string, unknown> }>([
    { case: 'absent', reply: {} },
    { case: 'not a list', reply: { commands: { name: 'compact' } } },
  ])('commandRecordsOf_NoList_IsEmpty: $case', ({ reply }) => {
    expect(commandRecordsOf(reply)).toEqual([]);
  });

  it('mergeInitNames_KeepsRecordMatchedByAlias', () => {
    const docx = record('docx', ['anthropic-skills:docx']);

    expect(
      mergeInitNames(
        [record('compact'), docx],
        ['anthropic-skills:docx', 'compact'],
      ),
    ).toEqual([docx, record('compact')]);
  });

  it('mergeInitNames_NewName_GetsEmptyRecord', () => {
    expect(mergeInitNames([record('compact')], ['compact', 'added'])).toEqual([
      record('compact'),
      emptyRecord('added'),
    ]);
  });

  it('mergeInitNames_DroppedName_LeavesList', () => {
    expect(
      mergeInitNames([record('compact'), record('gone')], ['compact']),
    ).toEqual([record('compact')]);
  });

  const docx = record('docx', ['anthropic-skills:docx']);
  const qualified = record('wigley:x', ['x']);
  const bare = record('x');

  it.each<{
    case: string;
    records: AgentCommand[];
    names: string[];
    expected: AgentCommand[];
  }>([
    {
      case: 'an exact name, then its alias',
      records: [docx],
      names: ['docx', 'anthropic-skills:docx'],
      expected: [docx, emptyRecord('anthropic-skills:docx')],
    },
    {
      case: 'an alias, then the exact name',
      records: [docx],
      names: ['anthropic-skills:docx', 'docx'],
      expected: [emptyRecord('anthropic-skills:docx'), docx],
    },
    {
      case: "an earlier record's alias beside a later record's exact name",
      records: [qualified, bare],
      names: ['x', 'wigley:x'],
      expected: [bare, qualified],
    },
  ])(
    'mergeInitNames_RecordTakenOnce: $case',
    ({ records, names, expected }) => {
      expect(mergeInitNames(records, names)).toEqual(expected);
    },
  );

  it.each<{ case: string; given: AgentCommand; aliases: string[] }>([
    { case: 'no plugin', given: record('compact', ['c']), aliases: ['c'] },
    {
      case: 'no alias',
      given: record('wigley:brief'),
      aliases: ['brief'],
    },
    {
      case: 'the alias held already',
      given: record('wigley:feature', ['feature', 'f']),
      aliases: ['feature', 'f'],
    },
    { case: 'a second colon', given: record('a:b:c'), aliases: ['b:c'] },
  ])('withNameAfterPlugin_AddsAlias: $case', ({ given, aliases }) => {
    expect(withNameAfterPlugin([given])).toEqual([{ ...given, aliases }]);
  });
});
