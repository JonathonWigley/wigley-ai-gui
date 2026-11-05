import type { SelfTestGroup, SelfTestScript } from '../../../contracts/plugin';
import {
  CHECKLIST_SEND,
  type LevelSelfTestDeps,
  levelLines,
  levelSelfTestScript,
  reportSend,
  sendKeys,
} from '../../workflow/main/level-selftest-script';

const SELFTEST_PROJECT_NAME = 'workflow-light-selftest';

const LIGHT_SEND = '/wigley:light';

const SENDS_AFTER_LAUNCH = [
  LIGHT_SEND,
  reportSend('done'),
  LIGHT_SEND,
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
    why: 'A session that only answers goes from Scope straight to done, with the L badge and the trail, and the No workflow tag leaves on the claim.',
    steps: [
      {
        width: 1200,
        keys: sendKeys(LIGHT_SEND),
        expect: line('shows scope'),
        alsoExpect: [
          anchored('level L'),
          anchored('trail Scope › Build › Check › Land'),
        ],
        screenshot: 'light-scope',
      },
      {
        keys: sendKeys(reportSend('done')),
        expect: line('shows done'),
        screenshot: 'light-answer-done',
      },
    ],
  },
  {
    name: 'full run',
    why: 'Reports move the trail through each step, the checklist draws with its count, and a second Light ask starts at Scope.',
    steps: [
      { keys: sendKeys(LIGHT_SEND), expect: line('shows scope') },
      { keys: sendKeys(reportSend('build')), expect: line('shows build') },
      {
        keys: sendKeys(CHECKLIST_SEND),
        expect: line('progress 1/3'),
        screenshot: 'light-build-checklist',
      },
      { keys: sendKeys(reportSend('check')), expect: line('shows check') },
      { keys: sendKeys(reportSend('land')), expect: line('shows land') },
      {
        width: 'start',
        keys: sendKeys(reportSend('done')),
        expect: line('shows done'),
        screenshot: 'light-done',
      },
    ],
  },
];

export function workflowLightSelfTestScript(
  deps: LevelSelfTestDeps,
): SelfTestScript {
  return levelSelfTestScript(deps, {
    projectName: SELFTEST_PROJECT_NAME,
    groups: GROUPS,
    sendsAfterLaunch: SENDS_AFTER_LAUNCH,
  });
}
