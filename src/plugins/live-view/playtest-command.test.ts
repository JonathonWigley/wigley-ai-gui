import { describe, expect, it } from 'vitest';
import { parsePlaytestCommand, type PlaytestSignal } from './playtest-command';

const P = '/clones/b/Game';

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
      given: 'flag between unity and command',
      command: `unity --project-path ${P} command editor_play`,
      result: null,
    },
    {
      given: 'redirect 2>&1',
      command: `unity command editor_play --result-only --project-path ${P} 2>&1`,
      result: start(P),
    },
    {
      given: 'redirect to a file',
      command: `unity command editor_play --project-path ${P} > /tmp/o.txt`,
      result: start(P),
    },
    {
      given: 'redirect joined',
      command: `unity command editor_play --project-path ${P} 2>/dev/null`,
      result: start(P),
    },
    {
      given: 'value flag before the name',
      command: `unity command --timeout 30 editor_play --project-path ${P}`,
      result: start(P),
    },
    {
      given: 'background &',
      command: `unity command editor_play --project-path ${P} &`,
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
      expect(parsePlaytestCommand(command)).toEqual(result);
    },
  );
});
