import type { ContextBreakdownAgentEvent } from '../../../contracts/agent';
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
import type { ChatSidePart, ChatSideSection } from '../../chat/contract';
import defaultLayout from '../layouts/default/layout.js';
import type {
  CompleteLayout,
  ContextSourcesPart,
  Layout,
} from '../layouts/layout';
import { contextSourcesManifest } from '../manifest';
import { breakdownInput, breakdownSummary } from './breakdown-input';

// `nameOf` is the session's name in the page log line; `breakdown` is a session's last breakdown, undefined before
// its first; `showPath` shows a full path with the home folder as `~`.
export interface ContextSectionDeps {
  kit: OwnerKitServices;
  log: PluginLog;
  nameOf(sessionId: string): string;
  breakdown(sessionId: string): ContextBreakdownAgentEvent | undefined;
  showPath(path: string): string;
}

// `part` draws a session's breakdown into its section of the session hub. `breakdownUpdated` redraws a session whose
// breakdown changed; `setLayouts` redraws every session's; `forget` drops a session that left.
export interface ContextSection {
  part: ChatSidePart;
  breakdownUpdated(sessionId: string): void;
  setLayouts(shown: ShownLayouts<Layout>): void;
  forget(sessionId: string): void;
}

// A parent chat handed `part.build` with its section, and the breakdown drawn into it last.
interface HeldParent {
  parent: HTMLElement;
  section: ChatSideSection;
  drawn: DrawnPart<ContextSourcesPart> | null;
}

// The breakdown is drawn directly into `parent`, leaving it empty before the session's first breakdown, so the section
// hides. A click on a source with items opens or closes it in that session, and one on the more line shows every
// source or the largest few again, each of which redraws. After a draw it logs
// `context in <name>: <summary>` when the summary differs from the last logged for that session.
export function createContextSection(deps: ContextSectionDeps): ContextSection {
  const layoutParts = createLayoutParts<Layout, CompleteLayout>({
    owner: contextSourcesManifest.id,
    defaultLayout,
    log: deps.log,
  });
  const held = new Map<string, HeldParent>();
  const openSources = new Map<string, Set<string>>();
  const showingAll = new Set<string>();
  const loggedSummaries = new Map<string, string>();

  const disposeDrawn = (holder: HeldParent) => {
    const drawn = holder.drawn;
    holder.drawn = null;
    drawn?.dispose();
  };

  const toggleSource = (sessionId: string, sourceId: string) => {
    const open = openSources.get(sessionId) ?? new Set<string>();
    if (!open.delete(sourceId)) {
      open.add(sourceId);
    }
    openSources.set(sessionId, open);
    redraw(sessionId);
  };

  const toggleShowsAll = (sessionId: string) => {
    if (!showingAll.delete(sessionId)) {
      showingAll.add(sessionId);
    }
    redraw(sessionId);
  };

  const redraw = (sessionId: string) => {
    const holder = held.get(sessionId);
    if (holder !== undefined) {
      draw(sessionId, holder);
    }
  };

  const drawBreakdown = (
    sessionId: string,
    holder: HeldParent,
    breakdown: ContextBreakdownAgentEvent,
  ) => {
    const input = breakdownInput(
      breakdown,
      {
        isOpen: (sourceId) =>
          openSources.get(sessionId)?.has(sourceId) ?? false,
        showsAll: showingAll.has(sessionId),
        showPath: deps.showPath,
      },
      {
        toggle: (sourceId) => toggleSource(sessionId, sourceId),
        toggleShowsAll: () => toggleShowsAll(sessionId),
      },
    );
    return layoutParts.draw(
      'breakdown',
      holder.parent,
      (part, slot, rollback) =>
        part(
          slot,
          input,
          createBaseKit(
            ownerBaseKitDeps(contextSourcesManifest, deps.kit, null, rollback),
          ),
        ),
    );
  };

  const logSummary = (sessionId: string, summary: string) => {
    if (loggedSummaries.get(sessionId) === summary) {
      return;
    }
    loggedSummaries.set(sessionId, summary);
    deps.log(`context in ${deps.nameOf(sessionId)}: ${summary}`);
  };

  function draw(sessionId: string, holder: HeldParent) {
    const breakdown = deps.breakdown(sessionId);
    try {
      disposeDrawn(holder);
    } finally {
      holder.parent.replaceChildren();
    }
    if (breakdown === undefined) {
      holder.section.setSummary(null);
      return;
    }
    holder.drawn = drawBreakdown(sessionId, holder, breakdown);
    const summary = breakdownSummary(breakdown);
    holder.section.setSummary(summary);
    logSummary(sessionId, summary);
  }

  return {
    part: {
      id: 'context-sources.breakdown',
      title: 'Context',
      order: 35,
      build(parent, sessionId, section) {
        const holder: HeldParent = { parent, section, drawn: null };
        held.set(sessionId, holder);
        draw(sessionId, holder);
        return {
          dispose() {
            if (held.get(sessionId) === holder) {
              held.delete(sessionId);
            }
            disposeDrawn(holder);
          },
        };
      },
    },
    breakdownUpdated(sessionId) {
      redraw(sessionId);
    },
    setLayouts(shown) {
      layoutParts.setLayouts(shown);
      callEach([...held], ([sessionId, holder]) => draw(sessionId, holder));
    },
    forget(sessionId) {
      openSources.delete(sessionId);
      showingAll.delete(sessionId);
      loggedSummaries.delete(sessionId);
    },
  };
}
