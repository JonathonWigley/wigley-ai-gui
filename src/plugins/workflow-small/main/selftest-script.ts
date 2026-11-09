import type { SelfTestGroup, SelfTestScript } from '../../../contracts/plugin';
import {
  CHECKLIST_SEND,
  type LevelSelfTestDeps,
  levelLines,
  levelSelfTestScript,
  reportSend,
  sendKeys,
} from '../../workflow/main/level-selftest-script';

const SELFTEST_PROJECT_NAME = 'workflow-small-selftest';

const SMALL_SEND = '/wigley:small';

const SENDS_AFTER_LAUNCH = [
  SMALL_SEND,
  reportSend('done'),
  SMALL_SEND,
  reportSend('build'),
  CHECKLIST_SEND,
  reportSend('check'),
  reportSend('land'),
  reportSend('done'),
];

const { line, anchored } = levelLines(SELFTEST_PROJECT_NAME);

const GROUPS: SelfTestGroup[] = [
  {
    name: 'answer only',
    why: 'A session that only answers goes from Scope straight to done, with the S badge and the trail, and the No workflow tag leaves on the claim.',
    steps: [
      {
        width: 1200,
        keys: sendKeys(SMALL_SEND),
        expect: line('shows scope'),
        alsoExpect: [
          anchored('level S'),
          anchored('trail Scope › Build › Check › Land'),
        ],
        screenshot: 'small-scope',
      },
      {
        keys: sendKeys(reportSend('done')),
        expect: line('shows done'),
        screenshot: 'small-answer-done',
      },
    ],
  },
  {
    name: 'full run',
    why: 'Reports move the trail through each step, the checklist draws with its count, and a second Small ask starts at Scope.',
    steps: [
      { keys: sendKeys(SMALL_SEND), expect: line('shows scope') },
      { keys: sendKeys(reportSend('build')), expect: line('shows build') },
      {
        keys: sendKeys(CHECKLIST_SEND),
        expect: line('progress 1/3'),
        screenshot: 'small-build-checklist',
      },
      { keys: sendKeys(reportSend('check')), expect: line('shows check') },
      { keys: sendKeys(reportSend('land')), expect: line('shows land') },
      {
        width: 'start',
        keys: sendKeys(reportSend('done')),
        expect: line('shows done'),
        screenshot: 'small-done',
      },
    ],
  },
];

export function workflowSmallSelfTestScript(
  deps: LevelSelfTestDeps,
): SelfTestScript {
  return levelSelfTestScript(deps, {
    projectName: SELFTEST_PROJECT_NAME,
    groups: GROUPS,
    sendsAfterLaunch: SENDS_AFTER_LAUNCH,
  });
}
