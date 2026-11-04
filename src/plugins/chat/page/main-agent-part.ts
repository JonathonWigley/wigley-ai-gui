import type { ChatSidePart } from '../contract';
import type { ComposerSurface } from './composer-kit';
import { dockSummary } from './working-turn';

// The session hub's Main agent section: the tab's activity dock, with the turn's
// time as its summary. The surface owns and draws the dock, so a rebuild moves the
// same slot.
export function createMainAgentPart(deps: {
  surfaceOf(sessionId: string): ComposerSurface | null;
}): ChatSidePart {
  return {
    id: 'chat.mainAgent',
    title: 'Main agent',
    order: 10,
    build(parent, sessionId, section) {
      const surface = deps.surfaceOf(sessionId);
      if (surface === null) {
        return {};
      }
      parent.append(surface.dockSlot);
      section.setSummary(dockSummary(surface.dockInput()));
      const subscription = surface.onDockChanged((input) =>
        section.setSummary(dockSummary(input)),
      );
      return {
        dispose() {
          subscription.dispose();
          surface.dockSlot.remove();
        },
      };
    },
  };
}
