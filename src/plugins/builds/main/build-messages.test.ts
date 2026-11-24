import { describe, expect, it } from 'vitest';
import type { SetRun } from '../builds-model';
import { buildJob, buildRecord, gameEntry } from '../contract.test-support';
import {
  endedMessage,
  failingMessage,
  setEndedMessage,
} from './build-messages';

const SHA = '2993a9e4c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6';
const game = gameEntry({
  id: 'tiki',
  label: 'Tiki Smash',
  kinds: { dev: { label: 'Dev', target: 'dev-target', downloads: [] } },
});

const success331 = buildRecord({
  id: 'tiki-1',
  number: '331',
  version: '0.12.0',
  branch: 'protos/physics-fun',
  revision: SHA,
  links: [
    { label: 'iOS', url: 'https://a/ios' },
    { label: 'Android', url: 'https://a/and' },
  ],
  webUrl: 'https://ci/331',
});
const block331 =
  'Build ended: Tiki Smash Dev #331 (0.12.0) — success\nBranch protos/physics-fun @ 2993a9e4\nLinks: iOS https://a/ios · Android https://a/and\nOpen: https://ci/331';
const failure332 = buildRecord({
  id: 'tiki-2',
  number: '332',
  branch: 'protos/physics-fun',
  revision: SHA,
  result: 'failure',
  jobs: [
    buildJob({
      id: 'ios',
      label: 'iOS build',
      result: 'failure',
      stepText: 'Archive failed',
    }),
  ],
});
const block332 =
  'Build ended: Tiki Smash Dev #332 — failure\nBranch protos/physics-fun @ 2993a9e4\nFailed: iOS build (ios) — Archive failed';

function setRun(buildIds: string[]): SetRun {
  return {
    id: 'r1',
    setId: 'rc',
    label: 'RC set',
    backendId: 'b1',
    gameId: 'tiki',
    sessionId: 's1',
    builds: buildIds.map((buildId) => ({ backendId: 'b1', buildId })),
    revision: SHA,
    createdAt: 0,
    notified: false,
    endedAt: null,
  };
}

describe('build messages', () => {
  it.each([
    {
      case: 'success, every field',
      text: () => endedMessage(game, success331),
      expected: block331,
    },
    {
      case: 'failure, one failed job',
      text: () => endedMessage(game, failure332),
      expected: block332,
    },
    {
      case: 'failure, no jobs',
      text: () =>
        endedMessage(
          game,
          buildRecord({
            id: 'run-7',
            result: 'failure',
            statusText: 'exit code 3',
          }),
        ),
      expected:
        'Build ended: Tiki Smash Dev — failure\nBranch main\nFailed: Dev (run-7) — exit code 3',
    },
    {
      case: 'cancelled',
      text: () =>
        endedMessage(game, buildRecord({ number: '5', result: 'cancelled' })),
      expected: 'Build ended: Tiki Smash Dev #5 — cancelled\nBranch main',
    },
    {
      case: 'failing, two jobs',
      text: () =>
        failingMessage(
          game,
          buildRecord({ number: '332', version: '0.12.0', state: 'running' }),
          [
            buildJob({
              id: 'ios',
              label: 'iOS build',
              result: 'failure',
              stepText: 'Archive failed',
            }),
            buildJob({ id: 'and', label: 'Android build', result: 'failure' }),
          ],
        ),
      expected:
        'Build failing: Tiki Smash Dev #332 — iOS build (ios) failed: Archive failed; Android build (and) failed',
    },
    {
      case: 'set ended',
      text: () =>
        setEndedMessage(game, setRun(['tiki-1', 'tiki-2']), [
          success331,
          failure332,
        ]),
      expected: `Set ended: Tiki Smash RC set — 1 of 2 succeeded\n\n${block331}\n\n${block332}`,
    },
    {
      case: 'set ref unlisted',
      text: () =>
        setEndedMessage(game, setRun(['tiki-1', 'tiki-2']), [success331]),
      expected: `Set ended: Tiki Smash RC set — 1 of 2 succeeded\n\n${block331}\n\nBuild tiki-2: no longer listed`,
    },
    {
      case: 'kind not in the game',
      text: () => endedMessage(game, buildRecord({ kind: 'qa', number: '5' })),
      expected: 'Build ended: Tiki Smash qa #5 — success\nBranch main',
    },
    {
      case: 'failed job with no text',
      text: () =>
        endedMessage(
          game,
          buildRecord({
            number: '332',
            result: 'failure',
            jobs: [
              buildJob({ id: 'ios', label: 'iOS build', result: 'failure' }),
            ],
          }),
        ),
      expected:
        'Build ended: Tiki Smash Dev #332 — failure\nBranch main\nFailed: iOS build (ios)',
    },
    {
      case: 'result null, no job, no status',
      text: () =>
        endedMessage(
          game,
          buildRecord({ id: 'run-8', number: '6', result: null }),
        ),
      expected:
        'Build ended: Tiki Smash Dev #6 — failure\nBranch main\nFailed: Dev (run-8)',
    },
  ])('$case', ({ text, expected }) => {
    expect(text()).toBe(expected);
  });
});
