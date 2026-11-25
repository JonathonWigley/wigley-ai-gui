import { describe, expect, it } from 'vitest';
import { FAKE_ASK_REPLY } from '../../../shared/fake-agent-harness';
import type { Review } from '../contract';
import {
  parseReviewReply,
  REVIEW_INPUT_LIMIT,
  reviewPrompt,
} from './review-prompt';

const NOT_JSON: Review = {
  state: 'unavailable',
  reason: "the reviewer's reply was not the expected JSON",
};

const reply = (fields: Record<string, unknown>) =>
  JSON.stringify({
    summary: 'Lists the project folder.',
    verdict: 'approve',
    risk: 'low',
    ...fields,
  });

const LISTS: Review = {
  state: 'done',
  summary: 'Lists the project folder.',
  verdict: 'approve',
  risk: 'low',
};

describe('parseReviewReply', () => {
  it.each([
    { case: 'plain JSON', text: reply({}), expected: LISTS },
    {
      case: 'JSON in a fence with prose around it',
      text: `Here is my review:\n\`\`\`json\n${reply({})}\n\`\`\`\nThat is all.`,
      expected: LISTS,
    },
    {
      case: 'an extra field',
      text: reply({ confidence: 0.9 }),
      expected: LISTS,
    },
    {
      case: 'a summary with surrounding spaces',
      text: reply({ summary: '  Lists the project folder. \n' }),
      expected: LISTS,
    },
    {
      case: "the fake harness's reply",
      text: FAKE_ASK_REPLY,
      expected: {
        state: 'done',
        summary: 'Deletes the file fake.txt from the project folder.',
        verdict: 'deny',
        risk: 'medium',
      },
    },
    {
      case: 'verdict maybe',
      text: reply({ verdict: 'maybe' }),
      expected: NOT_JSON,
    },
    {
      case: 'risk severe',
      text: reply({ risk: 'severe' }),
      expected: NOT_JSON,
    },
    {
      case: 'summary missing',
      text: reply({ summary: undefined }),
      expected: NOT_JSON,
    },
    { case: 'summary 42', text: reply({ summary: 42 }), expected: NOT_JSON },
    {
      case: 'summary blank',
      text: reply({ summary: '  ' }),
      expected: NOT_JSON,
    },
    { case: 'no braces', text: 'I would deny this.', expected: NOT_JSON },
    {
      case: 'broken JSON between the braces',
      text: '{"summary": "Lists", "verdict": }',
      expected: NOT_JSON,
    },
    { case: 'a JSON array', text: '[1]', expected: NOT_JSON },
  ])('parseReviewReply_$case', ({ text, expected }) => {
    expect(parseReviewReply(text)).toEqual(expected);
  });
});

describe('reviewPrompt', () => {
  // A string input whose JSON, quotes included, is `length` characters.
  const inputOfJsonLength = (length: number) => 'a'.repeat(length - 2);

  it.each([
    {
      case: 'a small Bash input',
      subject: {
        toolName: 'Bash',
        input: { command: 'npm test' },
        projectDir: '/work',
      },
      expected: [
        'Tool: Bash',
        'Project folder: /work',
        'Input:',
        '```json',
        '{\n  "command": "npm test"\n}',
        '```',
      ],
    },
    {
      case: 'no project folder',
      subject: {
        toolName: 'Read',
        input: { file_path: 'a.md' },
        projectDir: null,
      },
      expected: [
        'Tool: Read',
        'Project folder: none',
        'Input:',
        '```json',
        '{\n  "file_path": "a.md"\n}',
        '```',
      ],
    },
    {
      case: 'an undefined input',
      subject: { toolName: 'Bash', input: undefined, projectDir: '/work' },
      expected: [
        'Tool: Bash',
        'Project folder: /work',
        'Input:',
        '```json',
        'null',
        '```',
      ],
    },
    {
      case: 'an input at the limit',
      subject: {
        toolName: 'Write',
        input: inputOfJsonLength(REVIEW_INPUT_LIMIT),
        projectDir: '/work',
      },
      expected: [
        'Tool: Write',
        'Project folder: /work',
        'Input:',
        '```json',
        `"${inputOfJsonLength(REVIEW_INPUT_LIMIT)}"`,
        '```',
      ],
    },
    {
      case: 'an input one past the limit',
      subject: {
        toolName: 'Write',
        input: inputOfJsonLength(REVIEW_INPUT_LIMIT + 1),
        projectDir: '/work',
      },
      expected: [
        'Tool: Write',
        'Project folder: /work',
        'Input:',
        '```json',
        `"${inputOfJsonLength(REVIEW_INPUT_LIMIT + 1)}`,
        '```',
        'The input above is cut to its first 50000 of 50001 characters.',
      ],
    },
  ])('reviewPrompt_$case', ({ subject, expected }) => {
    expect(reviewPrompt(subject)).toBe(expected.join('\n'));
  });
});
