import type { SelfTestGroup, SelfTestScript } from '../../../contracts/plugin';
import {
  CHECKLIST_SEND,
  type LevelSelfTestDeps,
  levelLines,
  levelSelfTestScript,
  reportSend,
  sendKeys,
} from '../../workflow/main/level-selftest-script';

const SELFTEST_PROJECT_NAME = 'workflow-medium-selftest';

const MEDIUM_SEND = '/wigley:medium';

const SENDS_AFTER_LAUNCH = [
  MEDIUM_SEND,
  reportSend('build'),
  CHECKLIST_SEND,
  reportSend('review'),
  reportSend('fix'),
  reportSend('review'),
  reportSend('fix'),
  reportSend('land'),
  reportSend('done'),
];

const { line, anchored } = levelLines(SELFTEST_PROJECT_NAME);

const GROUPS: SelfTestGroup[] = [
  {
    name: 'level and trail',
    why: "The skill's start claims the session: the M badge, the five-word trail, and Interview as the first step, and the No workflow tag leaves.",
    steps: [
      {
        width: 1200,
        keys: sendKeys(MEDIUM_SEND),
        expect: line('shows interview'),
        alsoExpect: [
          anchored('level M'),
          anchored('trail Interview › Build › Review › Fix › Land'),
        ],
        screenshot: 'medium-interview',
      },
    ],
  },
  {
    name: 'steps move back',
    why: 'Reports move the trail forward and back, the checklist draws with its count, and a fix cycle may return to review.',
    steps: [
      { keys: sendKeys(reportSend('build')), expect: line('shows build') },
      {
        keys: sendKeys(CHECKLIST_SEND),
        expect: line('progress 1/3'),
        screenshot: 'medium-build-checklist',
      },
      { keys: sendKeys(reportSend('review')), expect: line('shows review') },
      {
        keys: sendKeys(reportSend('fix')),
        expect: line('shows fix'),
        screenshot: 'medium-fix-cycle',
      },
      { keys: sendKeys(reportSend('review')), expect: line('shows review') },
      { keys: sendKeys(reportSend('fix')), expect: line('shows fix') },
      { keys: sendKeys(reportSend('land')), expect: line('shows land') },
      {
        width: 'start',
        keys: sendKeys(reportSend('done')),
        expect: line('shows done'),
        screenshot: 'medium-done',
      },
    ],
  },
];

export function workflowMediumSelfTestScript(
  deps: LevelSelfTestDeps,
): SelfTestScript {
  return levelSelfTestScript(deps, {
    projectName: SELFTEST_PROJECT_NAME,
    groups: GROUPS,
    sendsAfterLaunch: SENDS_AFTER_LAUNCH,
  });
}
