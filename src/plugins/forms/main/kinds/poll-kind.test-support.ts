import {
  type AnswerStatus,
  type MainItemKind,
  RoundError,
} from '../../contract';
import { isJsonObject } from '../../../../shared/json';

// A registered kind for tests: a poll the user votes on, answerable, its
// list joining the fingerprint only when not empty.

interface Poll {
  title: string;
  options: string[];
}

interface PollEntry {
  index: number;
  // 1-based; 0 for no vote.
  vote: number;
}

interface PollResult {
  index: number;
  title: string;
  status: AnswerStatus;
  vote: number;
}

export const POLL_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    required: ['title', 'options'],
    properties: {
      title: { type: 'string' },
      options: { type: 'array', items: { type: 'string' } },
    },
  },
  description: 'Polls the user votes on.',
};

// A poll the user votes on.
export const POLL: Poll = { title: 'Lunch', options: ['soup', 'salad'] };

export const pollKind: MainItemKind<Poll, PollEntry, PollResult> = {
  spec: {
    id: 'poll',
    argsKey: 'polls',
    bodyKey: 'poll_answers',
    resultKey: 'polls',
    fingerprintJoinsWhenEmpty: false,
    answerable: true,
  },
  noun: 'poll',
  describe: () => POLL_SCHEMA,
  parse: (raw, at) => {
    if (!isJsonObject(raw) || typeof raw.title !== 'string') {
      throw new RoundError({ path: at, problem: 'each poll needs a title.' });
    }
    const options = Array.isArray(raw.options) ? raw.options.map(String) : [];
    return { title: raw.title, options };
  },
  layout: () => null,
  fingerprintContent: (poll) => ({
    title: poll.title,
    options: poll.options,
  }),
  readEntry: (index, saved) => ({
    index,
    vote: Number.isInteger(saved.vote) ? (saved.vote as number) : 0,
  }),
  recommendedEntry: (_poll, index) => ({ index, vote: 1 }),
  result: (poll, entry) => ({
    index: entry.index,
    title: poll.title,
    status: entry.vote > 0 ? 'answered' : 'untouched',
    vote: entry.vote,
  }),
  status: (result) => result.status,
};
