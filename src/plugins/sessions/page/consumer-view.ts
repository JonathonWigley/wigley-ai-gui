import type { Disposable, Registrations } from '../../../contracts/disposable';
import { createRegistrations } from '../../../shared/registrations';
import type { SessionsPageExports } from '../contract';

// One dependent's view of sessions' page exports: every tab and part it adds is
// filed under its registrations, and their disposal clears each activity it
// still holds. A session `onSessionRemoved` names leaves the store: its tabs'
// handles and its activities, which sessions has already dropped.
export function sessionsPageView(
  exports: SessionsPageExports,
  consumer: Registrations,
  onSessionRemoved: (listener: (sessionId: string) => void) => Disposable,
): SessionsPageExports {
  // The (sessionId, sourceId) pairs last set to a non-null activity, by a key
  // made of both.
  const heldActivities = new Map<string, [string, string]>();
  consumer.track({
    dispose() {
      for (const [sessionId, sourceId] of heldActivities.values()) {
        exports.setActivity(sessionId, sourceId, null);
      }
      heldActivities.clear();
    },
  });
  // One store entry per session, so its tab handles leave together.
  const sessionTabs = new Map<string, Registrations & Disposable>();
  consumer.track(
    onSessionRemoved((sessionId) => {
      sessionTabs.get(sessionId)?.dispose();
      sessionTabs.delete(sessionId);
      for (const [key, [heldSessionId]] of heldActivities) {
        if (heldSessionId === sessionId) {
          heldActivities.delete(key);
        }
      }
    }),
  );
  return {
    ...exports,
    addTab(sessionId, tab) {
      const tabs =
        sessionTabs.get(sessionId) ?? consumer.track(createRegistrations());
      sessionTabs.set(sessionId, tabs);
      return tabs.track(exports.addTab(sessionId, tab));
    },
    addRowPart: (part) => consumer.track(exports.addRowPart(part)),
    addBarPart: (part) => consumer.track(exports.addBarPart(part)),
    setActivity(sessionId, sourceId, activity) {
      exports.setActivity(sessionId, sourceId, activity);
      const key = JSON.stringify([sessionId, sourceId]);
      if (activity === null) {
        heldActivities.delete(key);
      } else {
        heldActivities.set(key, [sessionId, sourceId]);
      }
    },
  };
}
