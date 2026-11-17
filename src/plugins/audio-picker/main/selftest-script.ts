import { isDeepStrictEqual } from 'node:util';
import { HOST_DEADLINE_FIELD } from '../../../contracts/agent-forms';
import type { SelfTestScript, SelfTestStep } from '../../../contracts/plugin';
import type {
  ConnectedSession,
  SessionsMainExports,
  ToolResult,
} from '../../sessions/contract';
import type { AudioPick, AudioPickerPayload } from '../contract';
import { openFixturePicker, type SamplePickerArgs } from './fixtures';

// The sample picker under its self-test name; the run number in the overview
// changes its fingerprint, so a later run does not pre-fill from this one.
function selfTestPicker(args: SamplePickerArgs, run: number): SamplePickerArgs {
  return {
    ...args,
    heading: 'Self-test picker',
    overview: `Self-test run ${run}.`,
  };
}

// Moment 1 opens on tap_a, which plays to its end, and tap_b is chosen;
// moment 2's loop plays, stops and plays again, the variant set's play stops
// it, None of these, row 6 after the five candidates, is chosen by its number
// and gets the note `quieter`; the cursor then moves back to moment 1 and to
// its last and first rows.
const CHOOSE_AND_PLAY_STEPS: SelfTestStep[] = [
  {
    keys: ['p'],
    expect: '[audio-picker] play tap_a one-shot',
    alsoExpect: [/\[audio-picker\] ended tap_a/],
    checksFit: true,
    screenshot: 'list',
    why: '`ended` fires only when the Web Audio context runs, so the 0.15 s one-shot ending proves playback and not only decode.',
  },
  { keys: ['j'], expect: '[page] j ran audio-picker.nextRow' },
  { keys: ['Enter'], expect: '[audio-picker] chose tap_b on moment 1' },
  { keys: ['<C-l>'], expect: '[page] <C-l> ran audio-picker.nextMoment' },
  { keys: ['p'], expect: '[audio-picker] play hum loop' },
  {
    keys: ['p'],
    expect: '[audio-picker] stop hum',
    why: "`p` on the playing row stops it; a loop never ends on its own, so the stop is the picker's.",
  },
  { keys: ['p'], expect: '[audio-picker] play hum loop' },
  { keys: ['j'], expect: '[page] j ran audio-picker.nextRow' },
  {
    keys: ['p'],
    expect: '[audio-picker] play sparkle variants',
    alsoExpect: [/\[audio-picker\] stop hum/],
    why: "Starting a play stops the one playing. Sparkle's files are 0.1 s and end on their own (`ended sparkle`), so no step waits on a stop for it.",
  },
  {
    keys: ['6'],
    expect: '[audio-picker] chose None of these on moment 2',
    why: 'None of these takes the number after the last candidate; moment 2 holds the most candidates a moment can, so every row number draws.',
  },
  {
    keys: ['a'],
    expect: '[audio-picker] focused notes on moment 2',
    checksFit: true,
    screenshot: 'note',
  },
  {
    keys: ['q', 'u', 'i', 'e', 't', 'e', 'r', 'Escape', 'Escape'],
    expect: '[audio-picker] left the box',
  },
  { keys: ['<C-h>'], expect: '[page] <C-h> ran audio-picker.prevMoment' },
  { keys: ['G'], expect: '[page] G ran audio-picker.lastRow' },
  { keys: ['g', 'g'], expect: '[page] gg ran audio-picker.firstRow' },
];

// The cancel prompt opens and is dismissed; the picker is sent.
const CANCEL_AND_SEND_STEPS: SelfTestStep[] = [
  {
    keys: ['C'],
    expect: '[page] C ran audio-picker.askCancel',
    checksFit: true,
    screenshot: 'confirm',
  },
  { keys: ['n'], expect: '[page] n ran audio-picker.dismissConfirm' },
  { keys: ['<D-Enter>'], expect: '[audio-picker] submitted' },
];

// The preview picker opens in a session of its own, every file but `broken`
// decoding, and is cancelled, which closes its session.
const PREVIEW_STEPS: SelfTestStep[] = [
  {
    keys: [' ', 'z', 'l', 'm'],
    expect: '[sessions] activated Audio picker preview',
    alsoExpect: [
      /\[audio-picker\] decoded 6 of 7 files/,
      /\[audio-picker\] decode failed broken file 1: /,
    ],
    checksFit: true,
    screenshot: 'preview',
  },
  { keys: ['C'], expect: '[page] C ran audio-picker.askCancel' },
  { keys: ['y'], expect: '[audio-picker] cancelled' },
];

// The `files` of the 0-based candidate of the 0-based moment, as `args`
// lists them.
function candidateFiles(
  args: SamplePickerArgs,
  moment: number,
  candidate: number,
): string[] {
  const candidates = args.moments[moment].candidates as Record<
    string,
    unknown
  >[];
  return candidates[candidate].files as string[];
}

// tap_b chosen on moment 1, and None of these with the note `quieter` on
// moment 2. The files are absolute and normal as `samplePickerArgs` joined
// them, so parse leaves them as they are.
function expectedPicks(args: SamplePickerArgs): AudioPick[] {
  return [
    {
      moment: 'Button tap',
      choice: 2,
      candidate: {
        name: 'tap_b',
        library: 'Sample library',
        files: candidateFiles(args, 0, 1),
        play: 'one-shot',
        volume: 0.8,
        pitch: { min: -2, max: 2 },
        loudnessLufs: null,
        driveUrl: null,
      },
      note: '',
    },
    { moment: 'Room hum', choice: 0, candidate: null, note: 'quieter' },
  ];
}

function payloadProblems(
  payload: AudioPickerPayload,
  args: SamplePickerArgs,
): string[] {
  const problems: string[] = [];
  if (payload.outcome !== 'submitted') {
    problems.push(`outcome ${payload.outcome}`);
  }
  if (!isDeepStrictEqual(payload.picks, expectedPicks(args))) {
    problems.push(`picks differ: ${JSON.stringify(payload.picks)}`);
  }
  return problems;
}

// Each run ends the session the run before connected, connects
// `audio-picker-selftest-<run>` in project `audio-picker-selftest`, activates
// its row so the steps start in its popup whatever session the earlier
// scripts left selected, and opens the self-test picker over `args` there
// once `ready` (the sample sounds written) settles; the script checks the
// payload that call returns once the steps send it.
export function audioPickerSelfTestScript(
  sessions: Pick<SessionsMainExports, 'connect' | 'activate'>,
  ready: Promise<void>,
  args: SamplePickerArgs,
): SelfTestScript {
  let connected: ConnectedSession | null = null;
  return {
    pageBinds: [],
    settings: {},
    scrollsItself: [],
    open(run) {
      connected?.end();
      const session = sessions.connect({
        sessionId: `audio-picker-selftest-${run}`,
        projectDir: 'audio-picker-selftest',
        harness: 'claude',
        rowId: null,
        host: { [HOST_DEADLINE_FIELD]: 120 },
      });
      connected = session;
      sessions.activate(session.session.id);
      const result: Promise<ToolResult> = ready.then(() =>
        openFixturePicker(session, selfTestPicker(args, run)),
      );
      return {
        shownLine:
          '[audio-picker] form shown: audio-picker-selftest · Self-test picker',
        alsoShown: [/\[audio-picker\] decoded 8 of 8 files/],
        result,
      };
    },
    groups: [
      {
        name: 'choose and play',
        why: "The popup opens on each moment's recommended row; p plays the cursor's candidate the way its play format says and starting a play stops the one playing; Enter and a digit choose; a reaches the moment's notes box; the agent gets every choice and note back once ⌘↩ sends.",
        steps: CHOOSE_AND_PLAY_STEPS,
      },
      {
        name: 'cancel and send',
        why: 'C opens the cancel prompt and n keeps the picker; ⌘↩ sends it with no prompt.',
        steps: CANCEL_AND_SEND_STEPS,
      },
      {
        name: 'layout preview',
        why: 'Space z l m opens the preview picker in a session of its own with no agent and selects its row; every row state draws, a file that will not decode included; cancelling it closes that session.',
        steps: PREVIEW_STEPS,
      },
    ],
    problems: (result) => {
      const toolResult = result as ToolResult;
      if (toolResult.isError) {
        return [`open_audio_picker failed: ${toolResult.content[0]?.text}`];
      }
      return payloadProblems(
        toolResult.structuredContent as unknown as AudioPickerPayload,
        args,
      );
    },
  };
}
