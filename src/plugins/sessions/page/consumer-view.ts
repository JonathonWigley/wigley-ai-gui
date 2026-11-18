import type { Disposable, Registrations } from '../../../contracts/disposable';
import { createRegistrations } from '../../../shared/registrations';
import type { SessionsPageExports } from '../contract';

// One dependent's view of sessions' page exports: every tab, popup, part,
// section and `showOnly` hold it adds is filed under its registrations, and their disposal clears
// each activity it still holds. A session `onSessionRemoved` names leaves the
// store: its tabs' and popups' handles and its activities, which sessions has
// already dropped.
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
  // One store entry per session, so its tab and popup handles leave together.
  const sessionHandles = new Map<string, Registrations & Disposable>();
  const handlesOf = (sessionId: string) => {
    const handles =
      sessionHandles.get(sessionId) ?? consumer.track(createRegistrations());
    sessionHandles.set(sessionId, handles);
    return handles;
  };
  consumer.track(
    onSessionRemoved((sessionId) => {
      sessionHandles.get(sessionId)?.dispose();
      sessionHandles.delete(sessionId);
      for (const [key, [heldSessionId]] of heldActivities) {
        if (heldSessionId === sessionId) {
          heldActivities.delete(key);
        }
      }
    }),
  );
  return {
    ...exports,
    addTab: (sessionId, tab) =>
      handlesOf(sessionId).track(exports.addTab(sessionId, tab)),
    addPopup: (sessionId, popup) =>
      handlesOf(sessionId).track(exports.addPopup(sessionId, popup)),
    addRowPart: (part) => consumer.track(exports.addRowPart(part)),
    addBarPart: (part) => consumer.track(exports.addBarPart(part)),
    addSection: (section) => consumer.track(exports.addSection(section)),
    showOnly: (sectionId) => consumer.track(exports.showOnly(sectionId)),
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
