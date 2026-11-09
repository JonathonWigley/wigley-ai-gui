import { describe, expect, it } from 'vitest';
import {
  createKeyRecorder,
  type Judgement,
  type RecordRequest,
} from './key-recorder';

// A fake capture handing out the armed `onKey` / `onCancel`, one-shot as the
// page's is: a press or Esc disarms it. `arms` counts each arm, `disposes`
// each dispose of an armed capture.
function fakeCapture() {
  let armed: { onKey(keys: string): void; onCancel(): void } | null = null;
  const counts = { arms: 0, disposes: 0 };
  const take = () => {
    if (armed === null) {
      throw new Error('no capture armed');
    }
    const taken = armed;
    armed = null;
    return taken;
  };
  return {
    counts,
    captureKey(onKey: (keys: string) => void, onCancel: () => void) {
      counts.arms += 1;
      const capture = { onKey, onCancel };
      armed = capture;
      return {
        dispose() {
          if (armed === capture) {
            armed = null;
            counts.disposes += 1;
          }
        },
      };
    },
    press: (keys: string) => take().onKey(keys),
    escape: () => take().onCancel(),
    isArmed: () => armed !== null,
  };
}

const LEADER_REFUSAL: Judgement = {
  type: 'refused',
  note: 'Space is the leader',
  reason: 'leader',
};

// A recorder over the fake capture, with every log line, keep, type and
// cancelled call kept.
function recorderWith(overrides: Partial<RecordRequest> = {}) {
  const capture = fakeCapture();
  const logs: string[] = [];
  const kept: string[] = [];
  const typed: string[] = [];
  const cancelled: string[] = [];
  const recorder = createKeyRecorder({
    captureKey: capture.captureKey,
    changed: () => undefined,
    log: (line) => logs.push(line),
  });
  const request = (key: string): RecordRequest => ({
    key,
    replacing: null,
    prompt: 'Press a key',
    confirm: 'enter',
    judge: (keys) => (keys === '<Space>' ? LEADER_REFUSAL : { type: 'free' }),
    keep: (keys) => kept.push(keys),
    type: (text) => typed.push(text),
    cancelled: () => cancelled.push(key),
    ...overrides,
  });
  return { capture, logs, kept, typed, cancelled, recorder, request };
}

describe('createKeyRecorder', () => {
  it.each([
    {
      case: 'a key then Enter keeps it',
      presses: ['t', '<CR>'],
      kept: ['t'],
      typed: [],
      held: null,
      logs: ['recording row', 'recorded t', 'recording kept row t'],
    },
    {
      case: 'Enter first is recorded as the key',
      presses: ['<CR>'],
      kept: [],
      typed: [],
      held: '<CR>',
      logs: ['recording row', 'recorded <CR>'],
    },
    {
      case: 'Tab first types an empty box',
      presses: ['<Tab>'],
      kept: [],
      typed: [''],
      held: null,
      logs: ['recording row', 'recording typed row'],
    },
    {
      case: 'a key then Tab types it',
      presses: ['t', '<Tab>'],
      kept: [],
      typed: ['t'],
      held: null,
      logs: ['recording row', 'recorded t', 'recording typed row'],
    },
    {
      case: 'a refused press, then a key and Enter',
      presses: ['<Space>', 'u', '<CR>'],
      kept: ['u'],
      typed: [],
      held: null,
      logs: [
        'recording row',
        'recorded <Space>',
        'record refused <Space>: leader',
        'recorded u',
        'recording kept row u',
      ],
    },
    {
      case: 'Enter after only a refused press',
      presses: ['<Space>', '<CR>'],
      kept: [],
      typed: [],
      held: '<CR>',
      logs: [
        'recording row',
        'recorded <Space>',
        'record refused <Space>: leader',
        'recorded <CR>',
      ],
    },
  ])(
    'recorder_PressSequence_Outcome: $case',
    ({ presses, kept, typed, held, logs }) => {
      const shown = recorderWith();
      shown.recorder.start(shown.request('row'));

      for (const keys of presses) {
        shown.capture.press(keys);
      }

      expect(shown.kept).toEqual(kept);
      expect(shown.typed).toEqual(typed);
      expect(shown.recorder.current()?.keys ?? null).toBe(held);
      expect(shown.logs).toEqual(logs);
    },
  );

  it('recorder_PressConfirm_KeepsTheFirstAcceptedPressAtOnce', () => {
    const shown = recorderWith({ confirm: 'press' });
    shown.recorder.start(shown.request('find'));

    shown.capture.press('t');

    expect(shown.kept).toEqual(['t']);
    expect(shown.recorder.current()).toBeNull();
    expect(shown.capture.isArmed()).toBe(false);
    expect(shown.logs).not.toContain('recording kept find t');
  });

  it('recorder_Moves_HoldsTheNoteAndLogsWhereFrom', () => {
    const shown = recorderWith({
      judge: () => ({ type: 'moves', note: 'it moves here', from: ['p.b'] }),
    });
    shown.recorder.start(shown.request('row'));

    shown.capture.press('t');

    expect(shown.recorder.current()).toEqual({
      key: 'row',
      replacing: null,
      keys: 't',
      prompt: 'Enter keeps it — Tab types it, Esc cancels',
      note: 'it moves here',
      isRefused: false,
    });
    expect(shown.logs).toContain('record moves t from p.b');
    expect(shown.capture.isArmed()).toBe(true);
  });

  it('recorder_Refused_ShowsTheNoteAndKeepsTheHeldKeys', () => {
    const shown = recorderWith();
    shown.recorder.start(shown.request('row'));

    shown.capture.press('t');
    shown.capture.press('<Space>');

    expect(shown.recorder.current()).toMatchObject({
      keys: 't',
      note: 'Space is the leader',
      isRefused: true,
    });
  });

  it.each([
    {
      case: 'Esc',
      end: (shown: ReturnType<typeof recorderWith>) => shown.capture.escape(),
      cancelled: ['row'],
      disposes: 0,
    },
    {
      case: 'cancel()',
      end: (shown: ReturnType<typeof recorderWith>) => shown.recorder.cancel(),
      cancelled: [],
      disposes: 1,
    },
  ])('recorder_EndsAndCancels: $case', ({ end, cancelled, disposes }) => {
    const shown = recorderWith();
    shown.recorder.start(shown.request('row'));

    end(shown);

    expect(shown.cancelled).toEqual(cancelled);
    expect(shown.capture.counts.disposes).toBe(disposes);
    expect(shown.capture.isArmed()).toBe(false);
    expect(shown.recorder.current()).toBeNull();
    expect(shown.logs.at(-1)).toBe('recording cancelled row');
  });

  it('recorder_StartOverARunningOne_CancelsTheFirst', () => {
    const shown = recorderWith();
    shown.recorder.start(shown.request('first'));

    shown.recorder.start(shown.request('second'));

    expect(shown.cancelled).toEqual(['first']);
    expect(shown.recorder.current()?.key).toBe('second');
    expect(shown.capture.isArmed()).toBe(true);
  });

  it('recorder_CancelWhileIdle_LogsNothing', () => {
    const shown = recorderWith();

    shown.recorder.cancel();

    expect(shown.logs).toEqual([]);
  });
});
