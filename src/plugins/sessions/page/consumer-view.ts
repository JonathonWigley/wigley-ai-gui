import type { Registrations } from '../../../contracts/disposable';
import type { SessionsPageExports } from '../contract';

// One dependent's view of sessions' page exports: every tab and part it adds is
// filed under its registrations, and their disposal clears each activity it
// still holds.
export function sessionsPageView(
  exports: SessionsPageExports,
  consumer: Registrations,
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
  return {
    ...exports,
    addTab: (sessionId, tab) => consumer.track(exports.addTab(sessionId, tab)),
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
