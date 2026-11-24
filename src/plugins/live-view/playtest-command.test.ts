import { describe, expect, it } from 'vitest';
import type { CommandPattern } from '../../contracts/contributions';
import {
  parsePlaytestCommand,
  type PlaytestPatterns,
  type PlaytestSignal,
} from './playtest-command';

const P = '/clones/b/Game';

const UNITY_FLAGS = [
  '--timeout',
  '--port',
  '--pid',
  '--instance',
  '--runtime',
  '--runtime-path',
  '--detail',
  '--query',
  '--tag',
];

const unity = (words: string[]): CommandPattern => ({
  program: 'unity',
  words,
  valueFlags: UNITY_FLAGS,
  projectPathFlag: '--project-path',
  projectPathVariable: 'UNITY_PROJECT_PATH',
});

const CAPTURE_START: CommandPattern = {
  program: 'capture.py',
  words: ['start'],
  valueFlags: ['--fps', '--backend'],
  projectPathFlag: '--project-path',
};

// The wigley plugin's liveView patterns, which keep the commands the app read
// before patterns came from contributions.
const WIGLEY_PATTERNS: PlaytestPatterns = {
  open: [
    unity(['command', 'editor.playmode', 'start']),
    unity(['command', 'editor_play']),
    CAPTURE_START,
  ],
  close: [
    unity(['command', 'editor.playmode', 'stop']),
    unity(['command', 'editor_stop']),
  ],
};

const GODOT_PATTERNS: PlaytestPatterns = {
  open: [{ program: 'godot-play', words: ['run'] }],
  close: [{ program: 'godot-play', words: ['quit'] }],
};

const start = (projectPath: string | null): PlaytestSignal => ({
  kind: 'start',
  projectPath,
});
const stop = (projectPath: string | null): PlaytestSignal => ({
  kind: 'stop',
  projectPath,
});

describe('parsePlaytestCommand', () => {
  it.each<{ given: string; command: string; result: PlaytestSignal | null }>([
    {
      given: 'play',
      command: `unity command editor_play --result-only --project-path ${P}`,
      result: start(P),
    },
    {
      given: 'stop',
      command: `unity command editor_stop --result-only --project-path ${P}`,
      result: stop(P),
    },
    {
      given: 'grouped play',
      command: `unity command editor.playmode start --result-only --project-path ${P}`,
      result: start(P),
    },
    {
      given: 'grouped stop',
      command: `unity command editor.playmode stop --project-path ${P}`,
      result: stop(P),
    },
    {
      given: 'grouped name with no verb',
      command: `unity command editor.playmode --project-path ${P}`,
      result: null,
    },
    {
      given: 'other grouped command',
      command: `unity command editor status --project-path ${P}`,
      result: null,
    },
    {
      given: 'path from an earlier assignment',
      command: `P=${P}; unity command editor.playmode start --project-path $P`,
      result: start(P),
    },
    {
      given: 'quoted braced variable',
      command: `G=${P}\nunity command editor_play --project-path "\${G}"`,
      result: start(P),
    },
    {
      given: 'capture path from an assignment',
      command: `P=${P}; C=/s/capture.py; python3 "$C" start --project-path "$P"`,
      result: start(P),
    },
    {
      given: 'variable with a suffix',
      command:
        'ROOT=/clones/b; unity command editor_play --project-path $ROOT/Game',
      result: start(P),
    },
    {
      given: 'PWD after cd',
      command: `cd ${P}; Q="$PWD"; unity command editor.playmode start --project-path "$Q"`,
      result: start(P),
    },
    {
      given: 'variable never assigned',
      command: 'unity command editor_play --project-path $P',
      result: start(null),
    },
    {
      given: 'assignment in the same segment',
      command: `P=${P} unity command editor_play --project-path $P`,
      result: start(null),
    },
    {
      given: 'command substitution',
      command: 'unity command editor_play --project-path "$(pwd)"',
      result: start(null),
    },
    {
      given: 'UNITY_PROJECT_PATH exported',
      command: `cd ${P} && export UNITY_PROJECT_PATH=$PWD; unity command editor.playmode start`,
      result: start(P),
    },
    {
      given: 'UNITY_PROJECT_PATH before the program',
      command: `UNITY_PROJECT_PATH=${P} unity command editor_stop`,
      result: stop(P),
    },
    {
      given: 'flag over UNITY_PROJECT_PATH',
      command: `export UNITY_PROJECT_PATH=/a; unity command editor_play --project-path ${P}`,
      result: start(P),
    },
    {
      given: 'UNITY_PROJECT_PATH for capture',
      command: `export UNITY_PROJECT_PATH=${P}; python3 capture.py start`,
      result: start(null),
    },
    {
      given: 'cd folder with no path',
      command: `cd ${P}; unity command editor.playmode start --result-only`,
      result: start(P),
    },
    {
      given: 'UNITY_PROJECT_PATH over the cd folder',
      command: `cd /x; UNITY_PROJECT_PATH=${P} unity command editor_stop`,
      result: stop(P),
    },
    {
      given: 'no path',
      command: 'unity command editor_play --result-only',
      result: start(null),
    },
    {
      given: 'path before the name',
      command: `unity command --project-path ${P} editor_play`,
      result: start(P),
    },
    {
      given: '= form',
      command: `unity command editor_play --project-path=${P}`,
      result: start(P),
    },
    {
      given: 'double-quoted path',
      command: 'unity command editor_play --project-path "/Users/me/My Game"',
      result: start('/Users/me/My Game'),
    },
    {
      given: 'single-quoted path',
      command: "unity command editor_play --project-path '/Users/me/My Game'",
      result: start('/Users/me/My Game'),
    },
    {
      given: 'escaped space',
      command: 'unity command editor_play --project-path /Users/me/My\\ Game',
      result: start('/Users/me/My Game'),
    },
    {
      given: 'escape inside double quotes',
      command: 'unity command editor_play --project-path "/x/a\\"b"',
      result: start('/x/a"b'),
    },
    {
      given: 'repeated path',
      command: `unity command editor_play --project-path /a --project-path ${P}`,
      result: start(P),
    },
    {
      given: 'missing value',
      command: 'unity command editor_play --project-path',
      result: start(null),
    },
    {
      given: 'empty value',
      command: 'unity command editor_play --project-path=',
      result: start(null),
    },
    {
      given: 'flag after the path flag',
      command: 'unity command editor_play --project-path --result-only',
      result: start(null),
    },
    {
      given: 'unity by path',
      command: `/usr/local/bin/unity command editor_play --project-path ${P}`,
      result: start(P),
    },
    {
      given: 'assignment first',
      command: `UNITY_LOG=1 unity command editor_play --project-path ${P}`,
      result: start(P),
    },
    {
      given: 'path flag between unity and command',
      command: `unity --project-path ${P} command editor_play`,
      result: start(P),
    },
    {
      given: 'redirect 2>&1',
      command: `unity command 2>&1 editor_play --project-path ${P}`,
      result: start(P),
    },
    {
      given: 'redirect to a file',
      command: `unity command > /tmp/o.txt editor_play --project-path ${P}`,
      result: start(P),
    },
    {
      given: 'redirect joined',
      command: `unity command 2>/dev/null editor_play --project-path ${P}`,
      result: start(P),
    },
    {
      given: 'redirect &>',
      command: `unity command &>/dev/null editor_play --project-path ${P}`,
      result: start(P),
    },
    {
      given: 'value flag before the name',
      command: `unity command --timeout 30 editor_play --project-path ${P}`,
      result: start(P),
    },
    {
      given: 'after a backgrounded command',
      command: `sleep 2 & unity command editor_play --project-path ${P}`,
      result: start(P),
    },
    {
      given: 'tab between words',
      command: `unity command\teditor_play --project-path ${P}`,
      result: start(P),
    },
    {
      given: 'chained after cd',
      command: `cd /clones/b && unity command editor_play --project-path ${P}`,
      result: start(P),
    },
    {
      given: '||',
      command: `unity command editor_play --project-path ${P} || true`,
      result: start(P),
    },
    {
      given: 'pipe',
      command: `unity command editor_play --project-path ${P} | tail -1`,
      result: start(P),
    },
    {
      given: ';',
      command: `unity command editor_play --project-path ${P}; sleep 5`,
      result: start(P),
    },
    {
      given: 'newline',
      command: `cd /x\nunity command editor_stop --project-path ${P}`,
      result: stop(P),
    },
    {
      given: 'line continuation',
      command: `unity command \\\n  editor_play --project-path ${P}`,
      result: start(P),
    },
    {
      given: 'stop then play',
      command: 'unity command editor_stop && unity command editor_play',
      result: start(null),
    },
    {
      given: 'play then stop',
      command: 'unity command editor_play && unity command editor_stop',
      result: stop(null),
    },
    {
      given: 'capture start',
      command: `python3 /skills/unity-playtest/capture.py start --project-path ${P}`,
      result: start(P),
    },
    {
      given: 'capture start appended',
      command: `python3 capture.py start --append --project-path ${P}`,
      result: start(P),
    },
    {
      given: 'capture with python flag',
      command: `python3 -u capture.py start --fps 30 --project-path ${P}`,
      result: start(P),
    },
    {
      given: 'capture by python path',
      command: `/opt/homebrew/bin/python3.12 capture.py start --project-path ${P}`,
      result: start(P),
    },
    {
      given: 'capture after &&',
      command: `cd /x && python3 capture.py start --project-path ${P}`,
      result: start(P),
    },
    {
      given: 'capture stop',
      command: `python3 capture.py stop --project-path ${P}`,
      result: null,
    },
    {
      given: 'capture command',
      command: `python3 capture.py command --project-path ${P} -- editor_play`,
      result: null,
    },
    {
      given: 'capture not run by python',
      command: 'git add capture.py start',
      result: null,
    },
    {
      given: 'other unity command',
      command: `unity command editor_status --project-path ${P}`,
      result: null,
    },
    {
      given: 'unity status',
      command: 'unity status --json',
      result: null,
    },
    {
      given: 'unity-pool',
      command: 'unity-pool claim --branch main',
      result: null,
    },
    {
      given: 'echo, unquoted',
      command: 'echo unity command editor_play',
      result: null,
    },
    {
      given: 'echo, quoted',
      command: 'echo "unity command editor_play"',
      result: null,
    },
    {
      given: 'commit message',
      command: "git commit -m 'unity command editor_play'",
      result: null,
    },
    {
      given: 'subshell',
      command: `(unity command editor_play --project-path ${P})`,
      result: null,
    },
    {
      given: 'bash -c',
      command: `bash -c 'unity command editor_play --project-path ${P}'`,
      result: null,
    },
    {
      given: 'timeout wrapper',
      command: `timeout 60 unity command editor_play --project-path ${P}`,
      result: null,
    },
    {
      given: 'heredoc body',
      command: `cat > play.sh <<'EOF'\nunity command editor_play --project-path ${P}\nEOF`,
      result: null,
    },
    {
      given: 'command after a heredoc',
      command: `cat > play.sh <<EOF\nunity command editor_stop\nEOF\nunity command editor_play --project-path ${P}`,
      result: start(P),
    },
    {
      given: 'command after a tab-stripped heredoc',
      command: `cat <<-"EOF"\n\tunity command editor_play\n\tEOF\nunity command editor_stop --project-path ${P}`,
      result: stop(P),
    },
    {
      given: 'quoted heredoc terminator holding a space',
      command: `cat <<'END X'\nunity command editor_play --project-path ${P}\nEND X`,
      result: null,
    },
    {
      given: 'arithmetic shift, not a heredoc',
      command: `n=$((1<<2))\nunity command editor_play --project-path ${P}`,
      result: start(P),
    },
    {
      given: 'here-string',
      command: `cat <<< x\nunity command editor_play --project-path ${P}`,
      result: start(P),
    },
    {
      given: 'unclosed quote with a signal',
      command: 'unity command editor_play --project-path "/x y',
      result: start('/x y'),
    },
    {
      given: 'unclosed quote, no signal',
      command: 'echo "unclosed',
      result: null,
    },
    {
      given: 'empty text',
      command: '',
      result: null,
    },
  ])(
    'parsePlaytestCommand_ReadsTheSignal_given $given',
    ({ command, result }) => {
      expect(parsePlaytestCommand(command, WIGLEY_PATTERNS)).toEqual(result);
    },
  );

  it.each<{
    given: string;
    patterns: PlaytestPatterns;
    command: string;
    result: PlaytestSignal | null;
  }>([
    {
      given: 'NoPatterns_UnityStart_NoSignal',
      patterns: { open: [], close: [] },
      command: `unity command editor.playmode start --project-path ${P}`,
      result: null,
    },
    {
      given: 'CustomProgram_Words_Start',
      patterns: GODOT_PATTERNS,
      command: '/opt/bin/godot-play run --verbose',
      result: start(null),
    },
    {
      given: 'CustomProgram_Words_Stop',
      patterns: GODOT_PATTERNS,
      command: 'godot-play quit',
      result: stop(null),
    },
    {
      given: 'CustomProgram_NoVariable_CdIgnored',
      patterns: GODOT_PATTERNS,
      command: 'cd /g && godot-play run',
      result: start(null),
    },
    {
      given: 'CustomProgram_OtherWords_NoSignal',
      patterns: GODOT_PATTERNS,
      command: 'godot-play build run',
      result: null,
    },
    {
      given: 'ScriptPattern_PythonFlagsBeforeScript_Start',
      patterns: { open: [CAPTURE_START], close: [] },
      command: `python3 -u /x/capture.py start --project-path ${P}`,
      result: start(P),
    },
    {
      given: 'ScriptPattern_NotRunByPython_NoSignal',
      patterns: { open: [CAPTURE_START], close: [] },
      command: `/x/capture.py start --project-path ${P}`,
      result: null,
    },
    {
      given: 'UnityFlagBeforeCommand_Start',
      patterns: WIGLEY_PATTERNS,
      command: `unity --timeout 5 command editor_play --project-path ${P}`,
      result: start(P),
    },
    {
      given: 'OpenBeforeClose_SameWords_Start',
      patterns: {
        open: [{ program: 'play', words: ['go'] }],
        close: [{ program: 'play', words: ['go'] }],
      },
      command: 'play go',
      result: start(null),
    },
    {
      given: 'OwnPathFlag_Value_Start',
      patterns: {
        open: [
          {
            program: 'godot-play',
            words: ['run'],
            valueFlags: ['--scene'],
            projectPathFlag: '--path',
          },
        ],
        close: [],
      },
      command: 'godot-play --scene main run --path /g',
      result: start('/g'),
    },
    {
      given: 'OwnVariable_Assigned_Start',
      patterns: {
        open: [
          {
            program: 'godot-play',
            words: ['run'],
            projectPathVariable: 'GODOT_PROJECT',
          },
        ],
        close: [],
      },
      command: `GODOT_PROJECT=${P} godot-play run`,
      result: start(P),
    },
  ])(
    'parsePlaytestCommand_MatchesThePatterns_given $given',
    ({ patterns, command, result }) => {
      expect(parsePlaytestCommand(command, patterns)).toEqual(result);
    },
  );
});
