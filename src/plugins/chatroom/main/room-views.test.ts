import { describe, expect, it } from 'vitest';
import {
  type BoardRow,
  type Claim,
  type Participant,
  type RoomMessage,
  USER_PARTICIPANT,
} from '../contract';
import { buildRoomView } from './room-views';

function agent(
  rowId: string,
  agentId: string | null,
  name: string,
): Participant {
  return { kind: 'agent', rowId, agentId, mirrorId: null, name };
}

const lead = agent('rA', null, 'Lead');
const leadWorker = agent('rA', 'w1', 'Lead ▸ worker');
const peer = agent('rB', null, 'Peer');

function boardRow(rowId: string, name: string): BoardRow {
  return {
    rowId,
    name,
    harness: 'claude',
    state: 'working',
    folder: null,
    branch: null,
    clone: null,
    uncommitted: [],
    uncommittedMore: 0,
    unpushedPaths: null,
    unpushedMore: 0,
    claims: [],
  };
}

function message(
  id: number,
  fields: Partial<RoomMessage> & Pick<RoomMessage, 'thread' | 'from'>,
): RoomMessage {
  return {
    id,
    room: 'game',
    to: [],
    kind: 'note',
    body: `message ${id}`,
    refs: [],
    replyTo: null,
    answerBy: null,
    onNoAnswer: null,
    key: null,
    at: id * 1000,
    userWord: false,
    ...fields,
  };
}

describe('buildRoomView', () => {
  it('buildRoomView_Counts', () => {
    const question = message(1, {
      thread: 'plan-x',
      from: lead,
      kind: 'question',
      to: [USER_PARTICIPANT],
    });
    const answer = message(2, {
      thread: 'plan-x',
      from: USER_PARTICIPANT,
      kind: 'answer',
      replyTo: 1,
    });
    const blocker = message(3, {
      thread: 'session:rA',
      from: leadWorker,
      kind: 'blocker',
      to: [USER_PARTICIPANT],
    });
    const leadNote = message(4, { thread: 'general', from: lead });
    const leadMention = message(5, {
      thread: 'plan-x',
      from: lead,
      to: [USER_PARTICIPANT, peer],
    });
    const peerNote = message(6, { thread: 'general', from: peer, to: [lead] });
    const claim: Claim = {
      id: 'c1',
      room: 'game',
      holder: lead,
      target: { paths: ['src/**'] },
      reason: 'refactor',
      expiresAt: 99_000,
    };
    const rows = [
      boardRow('rA', 'Lead'),
      boardRow('rB', 'Peer'),
      boardRow('rC', 'Idle'),
    ];

    const view = buildRoomView({
      room: 'game',
      threads: [
        {
          thread: 'general',
          resolved: false,
          count: 2,
          lastId: 6,
          lastAt: 6000,
        },
        { thread: 'plan-x', resolved: true, count: 3, lastId: 5, lastAt: 5000 },
        {
          thread: 'session:rA',
          resolved: false,
          count: 1,
          lastId: 3,
          lastAt: 3000,
        },
      ],
      board: rows,
      claims: [claim],
      userUnread: [blocker, leadNote, leadMention, peerNote],
      messages: [question, answer, blocker, leadNote, leadMention, peerNote],
    });

    expect(view).toEqual({
      room: 'game',
      threads: [
        {
          thread: 'general',
          resolved: false,
          lastId: 6,
          userUnread: 2,
          userMentions: 0,
        },
        {
          thread: 'plan-x',
          resolved: true,
          lastId: 5,
          userUnread: 1,
          userMentions: 1,
        },
        {
          thread: 'session:rA',
          resolved: false,
          lastId: 3,
          userUnread: 1,
          userMentions: 1,
        },
      ],
      board: rows,
      claims: [claim],
      rowUnread: [
        { rowId: 'rA', unread: 3, mentions: 2, newestThread: 'plan-x' },
        { rowId: 'rB', unread: 1, mentions: 0, newestThread: 'general' },
        { rowId: 'rC', unread: 0, mentions: 0, newestThread: null },
      ],
      userAsks: [blocker],
    });
  });
});
