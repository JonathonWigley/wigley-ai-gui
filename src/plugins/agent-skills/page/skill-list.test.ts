import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAIN_AGENT_ID } from '../../../contracts/agent';
import {
  recordingAnchors,
  withUser,
} from '../../../shared/page/layout-host/test-layouts';
import { NO_FENCES } from '../../../shared/page/markdown-mount.test-support';
import {
  asHtml,
  FakeElement,
  findAll,
  installFakeDom,
} from '../../../shared/page/test-dom';
import type { Roster, RosterSkill } from '../../agents/contract';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout, SkillListInput } from '../layouts/layout';
import { createSkillList } from './skill-list';

const SESSION = 'row-1';

const MAIN_FOO: RosterSkill = {
  skill: 'foo',
  agentId: MAIN_AGENT_ID,
  ownerName: 'main',
};
// A subagent may be named `main`: its `agentId` says it is not the main agent.
const SUBAGENT_BAR: RosterSkill = {
  skill: 'bar',
  agentId: 'toolu_a',
  ownerName: 'main',
};
const REVIEWER_BAZ: RosterSkill = {
  skill: 'baz',
  agentId: 'toolu_b',
  ownerName: 'reviewer',
};

function rosterOf(skills: RosterSkill[]): Roster {
  return { agents: [], tasks: [], skills };
}

// A list over a roster the test sets; `nameOf` reads every session as `proj`.
function setUp(skills: RosterSkill[] = []) {
  let current = rosterOf(skills);
  const logged: string[] = [];
  const list = createSkillList({
    kit: {
      markdown: {
        block: (text) => text,
        inline: (text) => text,
        document: async (text) => text,
        ...NO_FENCES,
      },
      keys: recordingAnchors().keys,
      commands: { exists: () => true, run: () => undefined },
      platform: 'macos',
    },
    log: (message) => logged.push(message),
    nameOf: () => 'proj',
    roster: () => current,
  });
  const parent = new FakeElement('div');
  const summaries: (string | null)[] = [];
  const section = { setSummary: (text: string | null) => summaries.push(text) };
  const build = () => list.part.build(asHtml(parent), SESSION, section);
  const changeSkills = (next: RosterSkill[]) => {
    current = rosterOf(next);
    list.rosterChanged(SESSION);
  };
  return { list, parent, summaries, logged, build, changeSkills };
}

function namesIn(parent: FakeElement): string[] {
  return findAll(parent, 'agent-skills-name').map((name) => name.textContent);
}

beforeEach(() => {
  installFakeDom(vi.stubGlobal);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('skill list', () => {
  it('build_NoSkills_LeavesParentEmptyAndLogsNothing', () => {
    const { parent, summaries, logged, build } = setUp();

    build();

    expect(parent.children).toHaveLength(0);
    expect(summaries.at(-1)).toBeNull();
    expect(logged).toEqual([]);
  });

  it('build_MainAndSubagentSkill_TagsTakeTheirTones', () => {
    const { parent, summaries, logged, build } = setUp([
      MAIN_FOO,
      SUBAGENT_BAR,
    ]);

    build();

    const rows = findAll(parent, 'agent-skills-row');
    expect(rows).toHaveLength(2);
    expect(findAll(rows[0], 'ui-tag--neutral')).toHaveLength(1);
    expect(findAll(rows[1], 'ui-tag--accent')).toHaveLength(1);
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].dataset.layoutOwner).toBe('agent-skills');
    expect(summaries.at(-1)).toBe('2');
    expect(logged).toEqual(['skills in proj: foo (main), bar (main)']);
  });

  it('build_SkillStartedBySeveralAgents_DrawsOneRowWithCountedOwnerTags', () => {
    const { parent, summaries, build } = setUp([
      MAIN_FOO,
      { skill: 'foo', agentId: 'toolu_a', ownerName: 'reviewer' },
      { skill: 'foo', agentId: 'toolu_b', ownerName: 'reviewer' },
      REVIEWER_BAZ,
    ]);

    build();

    const rows = findAll(parent, 'agent-skills-row');
    const tagTexts = (row: FakeElement) =>
      findAll(row, 'ui-tag').map((tag) => tag.textContent);
    expect(namesIn(parent)).toEqual(['foo', 'baz']);
    expect(rows.map(tagTexts)).toEqual([['main', 'reviewer ×2'], ['reviewer']]);
    expect(findAll(rows[0], 'ui-tag').map((tag) => tag.title)).toEqual([
      'main',
      'reviewer ×2',
    ]);
    expect(summaries.at(-1)).toBe('2');
  });

  it('rosterChanged_SkillAddedThenListEmptied_RedrawsAndLogsEachText', () => {
    const { parent, summaries, logged, build, changeSkills } = setUp([
      MAIN_FOO,
    ]);
    build();

    changeSkills([MAIN_FOO, REVIEWER_BAZ]);
    const namesAfterAdd = namesIn(parent);
    const summaryAfterAdd = summaries.at(-1);
    changeSkills([]);

    expect(namesAfterAdd).toEqual(['foo', 'baz']);
    expect(summaryAfterAdd).toBe('2');
    expect(parent.children).toHaveLength(0);
    expect(summaries.at(-1)).toBeNull();
    expect(logged).toEqual([
      'skills in proj: foo (main)',
      'skills in proj: foo (main), baz (reviewer)',
      'skills in proj: none',
    ]);
  });

  // Each subagent tool call changes the roster; a redraw would close a row's
  // open tooltip.
  it('rosterChanged_SameSkills_KeepsTheDrawnList', () => {
    const { parent, logged, build, changeSkills } = setUp([MAIN_FOO]);
    build();
    const drawn = parent.children[0];

    changeSkills([{ ...MAIN_FOO }]);

    expect(parent.children[0]).toBe(drawn);
    expect(logged).toHaveLength(1);
  });

  // A chat layout change builds the part again before disposing the old build.
  it('dispose_OlderBuild_LeavesTheNewerBuildHeard', () => {
    const { parent, build, changeSkills } = setUp([MAIN_FOO]);
    const older = build();
    build();

    older.dispose?.();
    changeSkills([MAIN_FOO, REVIEWER_BAZ]);

    expect(namesIn(parent)).toEqual(['foo', 'baz']);
  });

  it('dispose_OnlyBuild_DrawsNoMore', () => {
    const { parent, build, changeSkills } = setUp([MAIN_FOO]);
    const built = build();

    built.dispose?.();
    changeSkills([MAIN_FOO, REVIEWER_BAZ]);

    expect(namesIn(parent)).toEqual(['foo']);
  });

  it('forget_LoggedSession_LogsItsTextAgain', () => {
    const { list, logged, build } = setUp([MAIN_FOO]);
    build();

    list.forget(SESSION);
    build();

    expect(logged).toEqual([
      'skills in proj: foo (main)',
      'skills in proj: foo (main)',
    ]);
  });

  it('setLayouts_UserSkillList_RedrawsWithItsInput', () => {
    const { list, build } = setUp([MAIN_FOO, SUBAGENT_BAR]);
    build();
    const inputs: SkillListInput[] = [];
    const recording: Layout = {
      skillList(parent, input, kit) {
        inputs.push(input);
        return { element: kit.el(parent, 'div', 'recorded-list') };
      },
    };

    list.setLayouts(withUser<Layout>(defaultLayout, recording));

    expect(inputs).toEqual([
      {
        skills: [
          { skill: 'foo', ownerName: 'main', isMain: true },
          { skill: 'bar', ownerName: 'main', isMain: false },
        ],
      },
    ]);
  });
});
