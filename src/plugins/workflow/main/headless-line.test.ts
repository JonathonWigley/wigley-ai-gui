import { describe, expect, it } from 'vitest';
import { HEADLESS_NOTE, HEADLESS_OFF_NOTE } from '../../chat/contract';
import { createHeadlessLines, type HeadlessLineSession } from './headless-line';

const ON = `text\n${HEADLESS_NOTE}`;
const OFF = `text\n${HEADLESS_OFF_NOTE}`;

function session(id: string, hostId: string): HeadlessLineSession {
  return { id, info: { sessionId: hostId, projectDir: null, harness: null } };
}

describe('createHeadlessLines', () => {
  // `seeded` is the flag when the session is tracked; each step then sets the
  // flag, optionally moves the session to `host`, and appends.
  it.each([
    {
      name: 'on',
      seeded: false,
      steps: [{ flag: true }, { flag: true }],
      expected: [ON, ON],
    },
    {
      name: 'on then off',
      seeded: false,
      steps: [{ flag: true }, { flag: false }, { flag: false }],
      expected: [ON, OFF, 'text'],
    },
    {
      name: 'never on',
      seeded: false,
      steps: [{ flag: false }, { flag: false }],
      expected: ['text', 'text'],
    },
    {
      name: 'seeded on, then off',
      seeded: true,
      steps: [{ flag: false }, { flag: false }],
      expected: [OFF, 'text'],
    },
    {
      name: 'on, then off and a new host id',
      seeded: false,
      steps: [{ flag: true }, { flag: false, host: 'h2' }, { flag: false }],
      expected: [ON, 'text', 'text'],
    },
    {
      name: 'on, then a new host id while still on, then off',
      seeded: false,
      steps: [{ flag: true }, { flag: true, host: 'h2' }, { flag: false }],
      expected: [ON, ON, OFF],
    },
  ])(
    'append_HeadlessState_AddsTheMatchingLine ($name)',
    ({ seeded, steps, expected }) => {
      let headless = seeded;
      const lines = createHeadlessLines(() => headless);
      const s1 = session('s1', 'h1');
      lines.track(s1);

      const results = steps.map((step) => {
        headless = step.flag;
        if (step.host !== undefined) {
          s1.info.sessionId = step.host;
        }
        return lines.append(s1, 'text');
      });

      expect(results).toEqual(expected);
    },
  );

  it('append_OffAcrossToolSessions_OffLineOnceForTheSessionOnly', () => {
    let headless = true;
    const lines = createHeadlessLines(() => headless);
    const s1 = session('s1', 'h1');
    const s2 = session('s2', 'h2');
    lines.track(s1);
    lines.track(s2);
    headless = false;

    // A second tool session of s1 starting after the switch keeps its state.
    lines.track(session('s1', 'h1'));
    const results = [
      lines.append(s1, 'text'),
      lines.append(session('s1', 'h1'), 'text'),
      lines.append(s2, 'text'),
    ];

    expect(results).toEqual([OFF, 'text', OFF]);
  });
});
