import { describe, expect, it } from 'vitest';
import {
  type Participant,
  participantKey,
  SYSTEM_PARTICIPANT,
  USER_PARTICIPANT,
} from './contract';

const agent = (rowId: string, agentId: string | null): Participant => ({
  kind: 'agent',
  rowId,
  agentId,
  mirrorId: null,
  name: 'Shop Revamp',
});

describe('chatroom contract', () => {
  it.each([
    {
      name: 'main agent',
      participant: agent('r1', null),
      key: 'agent:r1:main',
    },
    { name: 'subagent', participant: agent('r1', 'w7'), key: 'agent:r1:w7' },
    { name: 'user', participant: USER_PARTICIPANT, key: 'human' },
    { name: 'system', participant: SYSTEM_PARTICIPANT, key: 'system' },
    {
      name: 'mirror',
      participant: {
        kind: 'mirror',
        rowId: null,
        agentId: null,
        mirrorId: 'tg',
        name: 'Telegram',
      } satisfies Participant,
      key: 'mirror:tg',
    },
  ])('participantKey: $name → $key', ({ participant, key }) => {
    expect(participantKey(participant)).toBe(key);
  });
});
