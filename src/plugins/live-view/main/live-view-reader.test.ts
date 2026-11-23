import { describe, expect, it } from 'vitest';
import type { LiveViewContribution } from '../../../contracts/contributions';
import type {
  ContributionSource,
  ReadResult,
} from '../../contributions/contract';
import { liveViewReader } from './live-view-reader';

const SOURCE: ContributionSource = {
  pluginName: 'acme',
  pluginKey: 'acme@market',
  version: '1.0.0',
  root: '/plugins/acme',
  harnessId: 'claude',
};

const OPEN = {
  program: 'unity',
  words: ['command', 'editor_play'],
  valueFlags: ['--timeout'],
  projectPathFlag: '--project-path',
  projectPathVariable: 'UNITY_PROJECT_PATH',
};
const CLOSE = { program: 'godot-play', words: ['quit'] };
const PROBE = {
  file: 'unity/Probe.cs',
  entry: 'Acme.Probe.Run',
  runner: 'unityScript',
};

// A valid section with `open[0]` replaced by `pattern`.
const withOpen = (pattern: unknown) => ({ open: [pattern], close: [CLOSE] });
// A valid section whose probe is `probe`.
const withProbe = (probe: unknown) => ({ open: [OPEN], close: [CLOSE], probe });

const PROBE_REASON = 'probe: not { file, entry, runner: "unityScript" }';

const refused = (...reasons: string[]): ReadResult<LiveViewContribution> => ({
  ok: false,
  reasons,
});

describe('liveViewReader', () => {
  it.each<{
    given: string;
    section: unknown;
    result: ReadResult<LiveViewContribution>;
  }>([
    {
      given: 'patterns and a probe',
      section: { open: [OPEN], close: [CLOSE], probe: PROBE },
      result: {
        ok: true,
        value: {
          open: [OPEN],
          close: [{ ...CLOSE, valueFlags: [] }],
          probe: PROBE as LiveViewContribution['probe'],
        },
      },
    },
    {
      given: 'no probe',
      section: { open: [CLOSE], close: [CLOSE] },
      result: {
        ok: true,
        value: {
          open: [{ ...CLOSE, valueFlags: [] }],
          close: [{ ...CLOSE, valueFlags: [] }],
        },
      },
    },
    {
      given: 'not an object',
      section: [],
      result: refused('"liveView" is not an object'),
    },
    {
      given: 'open missing',
      section: { close: [CLOSE] },
      result: refused('open: not a list of command patterns'),
    },
    {
      given: 'close empty',
      section: { open: [OPEN], close: [] },
      result: refused('close: not a list of command patterns'),
    },
    {
      given: 'a pattern that is not an object',
      section: withOpen('unity'),
      result: refused('open: not a list of command patterns'),
    },
    {
      given: 'a program holding a slash',
      section: withOpen({ ...OPEN, program: '/usr/bin/unity' }),
      result: refused('open[0].program: not a program name'),
    },
    {
      given: 'an empty program',
      section: withOpen({ ...OPEN, program: '' }),
      result: refused('open[0].program: not a program name'),
    },
    {
      given: 'no words',
      section: withOpen({ ...OPEN, words: [] }),
      result: refused('open[0].words: not a list of words'),
    },
    {
      given: 'an empty word',
      section: withOpen({ ...OPEN, words: ['command', ''] }),
      result: refused('open[0].words: not a list of words'),
    },
    {
      given: 'a value flag with no dash',
      section: withOpen({ ...OPEN, valueFlags: ['timeout'] }),
      result: refused('open[0].valueFlags: not a list of flags'),
    },
    {
      given: 'a project path flag with no dash',
      section: withOpen({ ...OPEN, projectPathFlag: 'project-path' }),
      result: refused('open[0].projectPathFlag: not a flag'),
    },
    {
      given: 'a project path variable that is no name',
      section: withOpen({ ...OPEN, projectPathVariable: '$UNITY' }),
      result: refused('open[0].projectPathVariable: not a variable name'),
    },
    {
      given: 'a probe file with a .. part',
      section: withProbe({ ...PROBE, file: 'a/../../x.cs' }),
      result: refused(PROBE_REASON),
    },
    {
      given: 'an absolute probe file',
      section: withProbe({ ...PROBE, file: '/x.cs' }),
      result: refused(PROBE_REASON),
    },
    {
      given: 'an empty probe entry',
      section: withProbe({ ...PROBE, entry: '' }),
      result: refused(PROBE_REASON),
    },
    {
      given: 'another probe runner',
      section: withProbe({ ...PROBE, runner: 'godot' }),
      result: refused(PROBE_REASON),
    },
    {
      given: 'a bad pattern in each list',
      section: {
        open: [{ ...OPEN, program: 1 }],
        close: [CLOSE, { ...CLOSE, words: 'quit' }],
      },
      result: refused(
        'open[0].program: not a program name',
        'close[1].words: not a list of words',
      ),
    },
  ])(
    'read_AcceptsOrRefusesWithReasons_given $given',
    ({ section, result }) => {
      expect(liveViewReader.read(section, SOURCE)).toEqual(result);
    },
  );
});
