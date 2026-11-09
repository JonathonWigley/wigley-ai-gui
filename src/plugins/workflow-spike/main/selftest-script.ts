import type { SelfTestGroup, SelfTestScript } from '../../../contracts/plugin';
import {
  CHECKLIST_SEND,
  type LevelSelfTestDeps,
  levelLines,
  levelSelfTestScript,
  reportSend,
  sendKeys,
} from '../../workflow/main/level-selftest-script';

const SELFTEST_PROJECT_NAME = 'workflow-spike-selftest';

const SPIKE_SEND = '/wigley:spike';

const SENDS_AFTER_LAUNCH = [
  SPIKE_SEND,
  reportSend('done'),
  SPIKE_SEND,
  reportSend('build'),
  CHECKLIST_SEND,
  reportSend('check'),
  reportSend('build'),
  reportSend('check'),
  reportSend('land'),
  reportSend('done'),
];

const { line, anchored } = levelLines(SELFTEST_PROJECT_NAME);

const GROUPS: SelfTestGroup[] = [
  {
    name: 'answer only',
    why: 'A session that only answers goes from Interview straight to done, with the X badge and the trail, and the No workflow tag leaves on the claim.',
    steps: [
      {
        width: 1200,
        keys: sendKeys(SPIKE_SEND),
        expect: line('shows interview'),
        alsoExpect: [
          anchored('level X'),
          anchored('trail Interview › Build › Check › Land'),
        ],
        screenshot: 'spike-interview',
      },
      {
        keys: sendKeys(reportSend('done')),
        expect: line('shows done'),
        screenshot: 'spike-answer-done',
      },
    ],
  },
  {
    name: 'full run',
    why: 'Reports move the trail through each step, the checklist draws with its count, a second Spike ask starts at Interview, and a build reported after check moves the trail back to Build. The key turns headless on and off, and the strip chip and row tag show it.',
    steps: [
      { keys: sendKeys(SPIKE_SEND), expect: line('shows interview') },
      { keys: sendKeys(reportSend('build')), expect: line('shows build') },
      {
        keys: sendKeys(CHECKLIST_SEND),
        expect: line('progress 1/3'),
        screenshot: 'spike-build-checklist',
      },
      {
        keys: [' ', 'w', 'h'],
        expect: line('headless on'),
        screenshot: 'spike-headless-chip-on',
      },
      { keys: [' ', 'w', 'h'], expect: line('headless off') },
      { keys: sendKeys(reportSend('check')), expect: line('shows check') },
      {
        keys: sendKeys(reportSend('build')),
        expect: line('shows build'),
        screenshot: 'spike-build-again',
      },
      { keys: sendKeys(reportSend('check')), expect: line('shows check') },
      { keys: sendKeys(reportSend('land')), expect: line('shows land') },
      {
        width: 'start',
        keys: sendKeys(reportSend('done')),
        expect: line('shows done'),
        screenshot: 'spike-done',
      },
    ],
  },
];

export function workflowSpikeSelfTestScript(
  deps: LevelSelfTestDeps,
): SelfTestScript {
  return levelSelfTestScript(deps, {
    projectName: SELFTEST_PROJECT_NAME,
    groups: GROUPS,
    sendsAfterLaunch: SENDS_AFTER_LAUNCH,
  });
}
