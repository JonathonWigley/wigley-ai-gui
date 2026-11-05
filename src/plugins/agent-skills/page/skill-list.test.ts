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
import { noLayoutState } from '../../../shared/page/layout-host/fake-layout-state.test-support';

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
const MAIN_QUX: RosterSkill = {
  skill: 'qux',
  agentId: MAIN_AGENT_ID,
  ownerName: 'main',
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
      state: noLayoutState,
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
    list.rosterUpdated(SESSION);
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

  it('build_MainAndSubagentSkill_ListsOnlyTheMainAgentsNames', () => {
    const { parent, summaries, logged, build } = setUp([
      MAIN_FOO,
      SUBAGENT_BAR,
      REVIEWER_BAZ,
    ]);

    build();

    expect(namesIn(parent)).toEqual(['foo']);
    expect(findAll(parent, 'ui-tag')).toHaveLength(0);
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].dataset.layoutOwner).toBe('agent-skills');
    expect(summaries.at(-1)).toBe('1');
    expect(logged).toEqual(['skills in proj: foo']);
  });

  it('build_OnlySubagentSkills_LeavesParentEmptyAndLogsNothing', () => {
    const { parent, summaries, logged, build } = setUp([SUBAGENT_BAR]);

    build();

    expect(parent.children).toHaveLength(0);
    expect(summaries.at(-1)).toBeNull();
    expect(logged).toEqual([]);
  });

  it.each([
    ['repo/.claude/worktrees/sweeps:drive', 'drive'],
    ['/abs/repo:drive', 'drive'],
    ['wigley:writing-code', 'wigley:writing-code'],
    ['tiny', 'tiny'],
  ])('build_SkillNamed_%s_Shows_%s', (skill, shown) => {
    const { parent, build } = setUp([{ ...MAIN_FOO, skill }]);

    build();

    expect(namesIn(parent)).toEqual([shown]);
  });

  it('build_SameSkillBareAndScoped_DrawsOneRow', () => {
    const { parent, summaries, build } = setUp([
      { ...MAIN_FOO, skill: 'drive' },
      { ...MAIN_FOO, skill: 'repo/.claude:drive' },
    ]);

    build();

    expect(namesIn(parent)).toEqual(['drive']);
    expect(summaries.at(-1)).toBe('1');
  });

  it('rosterUpdated_SkillAddedThenListEmptied_RedrawsAndLogsEachText', () => {
    const { parent, summaries, logged, build, changeSkills } = setUp([
      MAIN_FOO,
    ]);
    build();

    changeSkills([MAIN_FOO, MAIN_QUX]);
    const namesAfterAdd = namesIn(parent);
    const summaryAfterAdd = summaries.at(-1);
    changeSkills([]);

    expect(namesAfterAdd).toEqual(['foo', 'qux']);
    expect(summaryAfterAdd).toBe('2');
    expect(parent.children).toHaveLength(0);
    expect(summaries.at(-1)).toBeNull();
    expect(logged).toEqual([
      'skills in proj: foo',
      'skills in proj: foo, qux',
      'skills in proj: none',
    ]);
  });

  // Each subagent tool call changes the roster; a redraw would close a row's
  // open tooltip.
  it('rosterUpdated_OnlySubagentSkillsDiffer_KeepsTheDrawnList', () => {
    const { parent, logged, build, changeSkills } = setUp([MAIN_FOO]);
    build();
    const drawn = parent.children[0];

    changeSkills([{ ...MAIN_FOO }, REVIEWER_BAZ]);

    expect(parent.children[0]).toBe(drawn);
    expect(logged).toHaveLength(1);
  });

  // A chat layout change builds the part again before disposing the old build.
  it('dispose_OlderBuild_LeavesTheNewerBuildHeard', () => {
    const { parent, build, changeSkills } = setUp([MAIN_FOO]);
    const older = build();
    build();

    older.dispose?.();
    changeSkills([MAIN_FOO, MAIN_QUX]);

    expect(namesIn(parent)).toEqual(['foo', 'qux']);
  });

  it('dispose_OnlyBuild_DrawsNoMore', () => {
    const { parent, build, changeSkills } = setUp([MAIN_FOO]);
    const built = build();

    built.dispose?.();
    changeSkills([MAIN_FOO, MAIN_QUX]);

    expect(namesIn(parent)).toEqual(['foo']);
  });

  it('forget_LoggedSession_LogsItsTextAgain', () => {
    const { list, logged, build } = setUp([MAIN_FOO]);
    build();

    list.forget(SESSION);
    build();

    expect(logged).toEqual(['skills in proj: foo', 'skills in proj: foo']);
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

    expect(inputs).toEqual([{ skills: ['foo'] }]);
  });
});
