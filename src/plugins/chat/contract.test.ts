import { describe, expect, it } from 'vitest';
import { type AdoptRequest, readAdoptRequest } from './contract';

const ADOPT: AdoptRequest = {
  hostSessionId: 'host-1',
  processId: 'host-1-1-1794300000000',
  rowId: 'r-1',
  projectDir: '/p',
  profile: 'work',
  headless: true,
  unattended: false,
  instructions: ['Run note.'],
  owner: null,
  controls: { mode: 'plan' },
  titles: { user: null, agent: null, firstMessage: 'Triage.' },
};

describe('readAdoptRequest', () => {
  it.each<{ case: string; value: unknown; expected: AdoptRequest | null }>([
    { case: 'a full request', value: ADOPT, expected: ADOPT },
    {
      case: 'an owner that is a string',
      value: { ...ADOPT, owner: 'scheduling' },
      expected: { ...ADOPT, owner: 'scheduling' },
    },
    { case: 'null', value: null, expected: null },
    { case: 'an array', value: [ADOPT], expected: null },
    {
      case: 'a missing rowId',
      value: { ...ADOPT, rowId: undefined },
      expected: null,
    },
    {
      case: 'a profile that is a number',
      value: { ...ADOPT, profile: 1 },
      expected: null,
    },
    {
      case: 'headless that is a string',
      value: { ...ADOPT, headless: 'true' },
      expected: null,
    },
    {
      case: 'a missing unattended',
      value: { ...ADOPT, unattended: undefined },
      expected: null,
    },
    {
      case: 'a missing owner',
      value: { ...ADOPT, owner: undefined },
      expected: null,
    },
    {
      case: 'instructions holding a number',
      value: { ...ADOPT, instructions: ['a', 1] },
      expected: null,
    },
    {
      case: 'a control value that is not a string',
      value: { ...ADOPT, controls: { mode: true } },
      expected: null,
    },
    {
      case: 'titles that are a string',
      value: { ...ADOPT, titles: 'Triage.' },
      expected: null,
    },
  ])('readAdoptRequest_Value_ReadsOrRefuses: $case', ({ value, expected }) => {
    expect(readAdoptRequest(value)).toEqual(expected);
  });
});
