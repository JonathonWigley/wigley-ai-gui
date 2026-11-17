import { describe, expect, it } from 'vitest';
import { HEADLESS_NOTE, HEADLESS_OFF_NOTE } from '../../chat/contract';
import { createHeadlessLines, type HeadlessLineSession } from './headless-line';

const ON = `text\n${HEADLESS_NOTE}`;
const OFF = `text\n${HEADLESS_OFF_NOTE}`;

function session(id: string, hostId: string): HeadlessLineSession {
  return { id, info: { sessionId: hostId, projectDir: null, harness: null, rowId: null } };
}

describe('createHeadlessLines', () => {
  // `launched` is the flag the session's process started with. Each step sets
  // the flag, optionally moves the session to `host` with a process started
  // with `launched` (as `/clear` does), and appends.
  it.each([
    {
      name: 'on',
      launched: false,
      steps: [{ flag: true }, { flag: true }],
      expected: [ON, ON],
    },
    {
      name: 'on then off',
      launched: false,
      steps: [{ flag: true }, { flag: false }, { flag: false }],
      expected: [ON, OFF, 'text'],
    },
    {
      name: 'never on',
      launched: false,
      steps: [{ flag: false }, { flag: false }],
      expected: ['text', 'text'],
    },
    {
      name: 'launched headless, off before the first call',
      launched: true,
      steps: [{ flag: false }, { flag: false }],
      expected: [OFF, 'text'],
    },
    {
      name: 'on, then off and cleared',
      launched: false,
      steps: [
        { flag: true },
        { flag: false, host: 'h2', launched: false },
        { flag: false },
      ],
      expected: [ON, 'text', 'text'],
    },
    {
      name: 'on, then cleared while on, then off',
      launched: false,
      steps: [
        { flag: true },
        { flag: true, host: 'h2', launched: true },
        { flag: false },
      ],
      expected: [ON, ON, OFF],
    },
    {
      name: 'never called, cleared while on, off before the first call',
      launched: false,
      steps: [{ flag: false, host: 'h2', launched: true }, { flag: false }],
      expected: [OFF, 'text'],
    },
  ])(
    'append_HeadlessState_AddsTheMatchingLine ($name)',
    ({ launched, steps, expected }) => {
      let headless = false;
      let launchedHeadless = launched;
      const lines = createHeadlessLines({
        isHeadless: () => headless,
        launchedHeadless: () => launchedHeadless,
      });
      const s1 = session('s1', 'h1');

      const results = steps.map((step) => {
        headless = step.flag;
        if (step.host !== undefined) {
          s1.info.sessionId = step.host;
          launchedHeadless = step.launched === true;
        }
        return lines.append(s1, 'text');
      });

      expect(results).toEqual(expected);
    },
  );

  it('append_OffAcrossToolSessions_OffLineOnceForTheSessionOnly', () => {
    const lines = createHeadlessLines({
      isHeadless: () => false,
      launchedHeadless: () => true,
    });
    const s1 = session('s1', 'h1');
    const s2 = session('s2', 'h2');

    // A second tool session of s1 shares its state.
    const results = [
      lines.append(s1, 'text'),
      lines.append(session('s1', 'h1'), 'text'),
      lines.append(s2, 'text'),
    ];

    expect(results).toEqual([OFF, 'text', OFF]);
  });
});
