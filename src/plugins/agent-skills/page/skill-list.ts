import { MAIN_AGENT_ID } from '../../../contracts/agent';
import type { PluginLog } from '../../../contracts/log';
import type { ShownLayouts } from '../../../contracts/plugin';
import { callEach } from '../../../shared/call-each';
import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../shared/page/layout-host/base-kit';
import type { DrawnPart } from '../../../shared/page/layout-host/draw-part';
import { createLayoutParts } from '../../../shared/page/layout-host/layout-parts';
import type { Roster } from '../../agents/contract';
import type { ChatSidePart, ChatSideSection } from '../../chat/contract';
import defaultLayout from '../layouts/default/layout.js';
import type {
  AgentSkillsPart,
  CompleteLayout,
  Layout,
} from '../layouts/layout';
import { agentSkillsManifest } from '../manifest';

// `nameOf` is the session's name in the page log line; `roster` is a session's
// current roster.
export interface SkillListDeps {
  kit: OwnerKitServices;
  log: PluginLog;
  nameOf(sessionId: string): string;
  roster(sessionId: string): Roster;
}

// `part` draws the main agent's skills into a session's section of the session
// hub. `rosterUpdated` redraws a session whose list changed; `setLayouts` redraws
// every session's; `forget` drops a session that left.
export interface SkillList {
  part: ChatSidePart;
  rosterUpdated(sessionId: string): void;
  setLayouts(shown: ShownLayouts<Layout>): void;
  forget(sessionId: string): void;
}

// A parent chat handed `part.build` with its section, the list drawn into it
// last, and the skills that draw read as text.
interface HeldParent {
  parent: HTMLElement;
  section: ChatSideSection;
  list: DrawnPart<AgentSkillsPart> | null;
  drawnSkills: string;
}

const NONE_TEXT = 'none';

// A project-scoped skill's name as Claude Code reports it: `<folder path>:<name>`.
const SKILL_FOLDER_PREFIX = /^.*\/[^/:]*:/;

function mainAgentSkillNames(roster: Roster): string[] {
  const names = roster.skills
    .filter(({ agentId }) => agentId === MAIN_AGENT_ID)
    .map(({ skill }) => skill.replace(SKILL_FOLDER_PREFIX, ''));
  return [...new Set(names)];
}

// The list is drawn directly into `parent`, leaving it empty with no skills, so
// the section hides. Every subagent tool call changes the roster, so a change
// that leaves the list as it was draws nothing, keeping a row's open tooltip.
// After a draw it logs `skills in <name>: <skill>, …` when the text differs
// from the last logged for that session, and `none` when the
// list empties; a session that has listed no skill logs nothing.
export function createSkillList(deps: SkillListDeps): SkillList {
  const layoutParts = createLayoutParts<Layout, CompleteLayout>({
    owner: agentSkillsManifest.id,
    defaultLayout,
    log: deps.log,
  });
  const held = new Map<string, HeldParent>();
  const loggedTexts = new Map<string, string>();

  const disposeList = (holder: HeldParent) => {
    const list = holder.list;
    holder.list = null;
    list?.dispose();
  };

  const drawList = (holder: HeldParent, skills: readonly string[]) =>
    layoutParts.draw('skillList', holder.parent, (skillList, slot, rollback) =>
      skillList(
        slot,
        { skills },
        createBaseKit(
          ownerBaseKitDeps(agentSkillsManifest, deps.kit, null, rollback),
        ),
      ),
    );

  const logSkills = (sessionId: string, skills: readonly string[]) => {
    const text = skills.length === 0 ? NONE_TEXT : skills.join(', ');
    const logged = loggedTexts.get(sessionId);
    const isFirstAndEmpty = logged === undefined && skills.length === 0;
    if (text === logged || isFirstAndEmpty) {
      return;
    }
    loggedTexts.set(sessionId, text);
    deps.log(`skills in ${deps.nameOf(sessionId)}: ${text}`);
  };

  const draw = (sessionId: string, holder: HeldParent) => {
    const skills = mainAgentSkillNames(deps.roster(sessionId));
    try {
      disposeList(holder);
    } finally {
      holder.parent.replaceChildren();
    }
    holder.drawnSkills = JSON.stringify(skills);
    if (skills.length > 0) {
      holder.list = drawList(holder, skills);
    }
    holder.section.setSummary(
      skills.length === 0 ? null : String(skills.length),
    );
    logSkills(sessionId, skills);
  };

  return {
    part: {
      id: 'agent-skills.list',
      title: 'Skills',
      order: 30,
      build(parent, sessionId, section) {
        const holder: HeldParent = {
          parent,
          section,
          list: null,
          drawnSkills: '',
        };
        held.set(sessionId, holder);
        draw(sessionId, holder);
        return {
          dispose() {
            if (held.get(sessionId) === holder) {
              held.delete(sessionId);
            }
            disposeList(holder);
          },
        };
      },
    },
    rosterUpdated(sessionId) {
      const holder = held.get(sessionId);
      const isUnchanged =
        holder?.drawnSkills ===
        JSON.stringify(mainAgentSkillNames(deps.roster(sessionId)));
      if (holder !== undefined && !isUnchanged) {
        draw(sessionId, holder);
      }
    },
    setLayouts(shown) {
      layoutParts.setLayouts(shown);
      callEach([...held], ([sessionId, holder]) => draw(sessionId, holder));
    },
    forget(sessionId) {
      loggedTexts.delete(sessionId);
    },
  };
}
