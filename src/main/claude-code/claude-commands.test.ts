import { describe, expect, it } from 'vitest';
import type { AgentCommand } from '../../contracts/agent';
import { commandRecordsOf, mergeInitNames } from './claude-commands';

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

  it('mergeInitNames_RecordTakenOnce', () => {
    const docx = record('docx', ['anthropic-skills:docx']);

    expect(mergeInitNames([docx], ['docx', 'anthropic-skills:docx'])).toEqual([
      docx,
      emptyRecord('anthropic-skills:docx'),
    ]);
  });
});
