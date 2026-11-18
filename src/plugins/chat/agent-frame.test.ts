import { describe, expect, it } from 'vitest';
import {
  frameAgentMessage,
  frameSenderName,
  readAgentFrame,
} from './agent-frame';

const FRAME_OPENING = '[Message from the agent in session "Planner"';

describe('agent frame', () => {
  it.each([
    { given: 'a plain name', title: 'Planner', text: 'go', from: 'Planner' },
    {
      given: 'a name with "',
      title: 'Plan "auth"',
      text: 'a\nb',
      from: 'Plan "auth"',
    },
    {
      given: 'a name with \\"',
      title: 'C:\\dir\\"x"',
      text: 'go',
      from: 'C:\\dir\\"x"',
    },
    {
      given: 'a multi-line body',
      title: 'Planner',
      text: 'one\ntwo\n\nthree',
      from: 'Planner',
    },
    { given: 'an empty-line body', title: 'Planner', text: '', from: 'Planner' },
  ])(
    'readAgentFrame reads back what frameAgentMessage writes: $given',
    ({ title, text, from }) => {
      const framed = frameAgentMessage(
        frameSenderName(title, null, 'row-1'),
        text,
      );

      expect(readAgentFrame(framed)).toEqual({ from, body: text });
    },
  );

  it.each([
    { given: 'plain text', text: 'run the tests\nplease' },
    {
      given: "the frame's opening words without the closing ]",
      text: `${FRAME_OPENING} — not typed by the user\ngo`,
    },
    {
      given: 'the frame on a second line',
      text: `hi\n${FRAME_OPENING} — not typed by the user]\ngo`,
    },
    {
      given: 'a frame line with no newline',
      text: `${FRAME_OPENING} — not typed by the user]`,
    },
  ])(
    'readAgentFrame returns null for text that is not a frame: $given',
    ({ text }) => {
      expect(readAgentFrame(text)).toBeNull();
    },
  );

  it.each([
    {
      given: 'newlines and runs of spaces',
      title: ' fix the\nlogin  bug ',
      label: 'alpha 2',
      expected: 'fix the login bug',
    },
    {
      given: 'a long title',
      title: 'é'.repeat(100),
      label: 'alpha 2',
      expected: `${'é'.repeat(79)}…`,
    },
    {
      given: 'a blank title with a label',
      title: ' \n ',
      label: ' alpha\t2 ',
      expected: 'alpha 2',
    },
    {
      given: 'a blank title and label',
      title: null,
      label: '  ',
      expected: 'row-7',
    },
  ])(
    'frameSenderName cleans, caps and falls back: $given',
    ({ title, label, expected }) => {
      expect(frameSenderName(title, label, 'row-7')).toBe(expected);
    },
  );
});
