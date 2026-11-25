// The self-test scripts of the sample Small, Medium and Spike workflows. Each
// adds its sample declaration through the self-test hooks as it first opens,
// since the self-test home has no installed agent plugin, then runs the level
// script. Each group
// name starts with the workflow's label, so the workflow plugin's scripts keep
// their group names apart.

import type { Disposable } from '../../../contracts/disposable';
import type { SelfTestGroup, SelfTestScript } from '../../../contracts/plugin';
import { sampleQualified } from '../../../shared/sample-plugin';
import {
  type SampleWorkflowId,
  sampleDeclared,
} from '../declared/sample-workflows';
import {
  CHECKLIST_SEND,
  type LevelSelfTestDeps,
  levelLines,
  levelSelfTestScript,
  reportSend,
  sendKeys,
} from './level-selftest-script';

interface SampleLevelSpec {
  id: SampleWorkflowId;
  projectName: string;
  groups: SelfTestGroup[];
  sendsAfterLaunch: readonly string[];
}

const SMALL_PROJECT_NAME = 'sample-small-selftest';
const SMALL_SEND = `/${sampleQualified('small')}`;
const small = levelLines(SMALL_PROJECT_NAME);

const SMALL: SampleLevelSpec = {
  id: 'small',
  projectName: SMALL_PROJECT_NAME,
  sendsAfterLaunch: [
    SMALL_SEND,
    reportSend('answered'),
    SMALL_SEND,
    reportSend('make'),
    CHECKLIST_SEND,
    reportSend('review'),
    reportSend('close'),
    reportSend('done'),
  ],
  groups: [
    {
      name: 'Small: answer only',
      why: 'A session that only answers goes from Explore to Answered, a neutral end with no step of the trail done, with the S badge and the trail, and the No workflow tag leaves on the claim.',
      steps: [
        {
          width: 1200,
          keys: sendKeys(SMALL_SEND),
          expect: small.line('shows scope'),
          alsoExpect: [
            small.anchored('level S'),
            small.anchored('trail Explore › Make › Review › Close'),
          ],
          screenshot: 'small-scope',
        },
        {
          keys: sendKeys(reportSend('answered')),
          expect: small.line('shows answered'),
          screenshot: 'small-answered',
        },
      ],
    },
    {
      name: 'Small: full run',
      why: 'Reports move the trail through each step, the checklist draws with its count, and a second Small ask starts at Explore. The key turns headless on and off, and the strip chip and row tag show it.',
      steps: [
        { keys: sendKeys(SMALL_SEND), expect: small.line('shows scope') },
        {
          keys: sendKeys(reportSend('make')),
          expect: small.line('shows build'),
        },
        {
          keys: sendKeys(CHECKLIST_SEND),
          expect: small.line('progress 1/3'),
          screenshot: 'small-build-checklist',
        },
        {
          keys: [' ', 'w', 'h'],
          expect: small.line('headless on'),
          screenshot: 'small-headless-chip-on',
        },
        { keys: [' ', 'w', 'h'], expect: small.line('headless off') },
        {
          keys: sendKeys(reportSend('review')),
          expect: small.line('shows check'),
        },
        {
          keys: sendKeys(reportSend('close')),
          expect: small.line('shows land'),
        },
        {
          width: 'start',
          keys: sendKeys(reportSend('done')),
          expect: small.line('shows done'),
          screenshot: 'small-done',
        },
      ],
    },
  ],
};

const MEDIUM_PROJECT_NAME = 'sample-medium-selftest';
const MEDIUM_SEND = `/${sampleQualified('medium')}`;
const medium = levelLines(MEDIUM_PROJECT_NAME);

const MEDIUM: SampleLevelSpec = {
  id: 'medium',
  projectName: MEDIUM_PROJECT_NAME,
  sendsAfterLaunch: [
    MEDIUM_SEND,
    reportSend('make'),
    CHECKLIST_SEND,
    reportSend('review'),
    reportSend('fix'),
    reportSend('review'),
    reportSend('fix'),
    reportSend('close'),
    reportSend('done'),
  ],
  groups: [
    {
      name: 'Medium: level and trail',
      why: "The skill's start claims the session: the M badge, the five-word trail, and Interview as the first step, and the No workflow tag leaves.",
      steps: [
        {
          width: 1200,
          keys: sendKeys(MEDIUM_SEND),
          expect: medium.line('shows interview'),
          alsoExpect: [
            medium.anchored('level M'),
            medium.anchored('trail Interview › Make › Review › Fix › Close'),
          ],
          screenshot: 'medium-interview',
        },
      ],
    },
    {
      name: 'Medium: steps move back',
      why: 'Reports move the trail forward and back, the checklist draws with its count, and a fix cycle may return to review.',
      steps: [
        {
          keys: sendKeys(reportSend('make')),
          expect: medium.line('shows build'),
        },
        {
          keys: sendKeys(CHECKLIST_SEND),
          expect: medium.line('progress 1/3'),
          screenshot: 'medium-build-checklist',
        },
        {
          keys: sendKeys(reportSend('review')),
          expect: medium.line('shows review'),
        },
        {
          keys: sendKeys(reportSend('fix')),
          expect: medium.line('shows fix'),
          screenshot: 'medium-fix-cycle',
        },
        {
          keys: sendKeys(reportSend('review')),
          expect: medium.line('shows review'),
        },
        {
          keys: sendKeys(reportSend('fix')),
          expect: medium.line('shows fix'),
        },
        {
          keys: sendKeys(reportSend('close')),
          expect: medium.line('shows land'),
        },
        {
          width: 'start',
          keys: sendKeys(reportSend('done')),
          expect: medium.line('shows done'),
          screenshot: 'medium-done',
        },
      ],
    },
  ],
};

const SPIKE_PROJECT_NAME = 'sample-spike-selftest';
const SPIKE_SEND = `/${sampleQualified('spike')}`;
const spike = levelLines(SPIKE_PROJECT_NAME);

const SPIKE: SampleLevelSpec = {
  id: 'spike',
  projectName: SPIKE_PROJECT_NAME,
  sendsAfterLaunch: [
    SPIKE_SEND,
    reportSend('done'),
    SPIKE_SEND,
    reportSend('make'),
    CHECKLIST_SEND,
    reportSend('review'),
    reportSend('make'),
    reportSend('review'),
    reportSend('close'),
    reportSend('done'),
  ],
  groups: [
    {
      name: 'Spike: answer only',
      why: 'A session that only answers goes from Interview straight to done, with the X badge and the trail, and the No workflow tag leaves on the claim.',
      steps: [
        {
          width: 1200,
          keys: sendKeys(SPIKE_SEND),
          expect: spike.line('shows interview'),
          alsoExpect: [
            spike.anchored('level X'),
            spike.anchored('trail Interview › Make › Review › Close'),
          ],
          screenshot: 'spike-interview',
        },
        {
          keys: sendKeys(reportSend('done')),
          expect: spike.line('shows done'),
          screenshot: 'spike-answer-done',
        },
      ],
    },
    {
      name: 'Spike: full run',
      why: 'Reports move the trail through each step, the checklist draws with its count, a second Spike ask starts at Interview, and a make reported after review moves the trail back to Make. The key turns headless on and off, and the strip chip and row tag show it.',
      steps: [
        {
          keys: sendKeys(SPIKE_SEND),
          expect: spike.line('shows interview'),
        },
        {
          keys: sendKeys(reportSend('make')),
          expect: spike.line('shows build'),
        },
        {
          keys: sendKeys(CHECKLIST_SEND),
          expect: spike.line('progress 1/3'),
          screenshot: 'spike-build-checklist',
        },
        {
          keys: [' ', 'w', 'h'],
          expect: spike.line('headless on'),
          screenshot: 'spike-headless-chip-on',
        },
        { keys: [' ', 'w', 'h'], expect: spike.line('headless off') },
        {
          keys: sendKeys(reportSend('review')),
          expect: spike.line('shows check'),
        },
        {
          keys: sendKeys(reportSend('make')),
          expect: spike.line('shows build'),
          screenshot: 'spike-build-again',
        },
        {
          keys: sendKeys(reportSend('review')),
          expect: spike.line('shows check'),
        },
        {
          keys: sendKeys(reportSend('close')),
          expect: spike.line('shows land'),
        },
        {
          width: 'start',
          keys: sendKeys(reportSend('done')),
          expect: spike.line('shows done'),
          screenshot: 'spike-done',
        },
      ],
    },
  ],
};

// The level script of sample `spec.id`, whose first open adds the sample for
// the rest of the app's run.
function sampleLevelScript(
  deps: LevelSelfTestDeps,
  spec: SampleLevelSpec,
): SelfTestScript {
  const script = levelSelfTestScript(deps, {
    projectName: spec.projectName,
    groups: spec.groups,
    sendsAfterLaunch: spec.sendsAfterLaunch,
  });
  let added: Disposable | null = null;
  return {
    ...script,
    open(run) {
      added ??= deps.hooks.addDeclared(sampleDeclared(spec.id));
      return script.open(run);
    },
  };
}

// The Spike, Small and Medium scripts, in the order their plugins once
// started.
export function sampleLevelSelfTestScripts(
  deps: LevelSelfTestDeps,
): SelfTestScript[] {
  return [SPIKE, SMALL, MEDIUM].map((spec) => sampleLevelScript(deps, spec));
}
