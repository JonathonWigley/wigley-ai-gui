import type { Registrations } from '../../../contracts/disposable';
import type { OwnedSession, SessionsMainExports } from '../contract';

// Files the session under the consumer, whose stop ends it. Its `end` goes
// through the filed handle, so an ended session leaves the store and ends once.
function endedWith<Session extends { end(): void }>(
  consumer: Registrations,
  session: Session,
): Session {
  const ownEnd = session.end;
  const handle = consumer.track({ dispose: () => ownEnd.call(session) });
  session.end = () => handle.dispose();
  return session;
}

// `endedWith` for an owned session, whose `keep` also leaves the store
// without ending it, so the consumer's stop after a `keep` ends nothing.
function ownedWith(consumer: Registrations, owned: OwnedSession): OwnedSession {
  const ownEnd = owned.end;
  const ownKeep = owned.keep;
  let isKept = false;
  const handle = consumer.track({
    dispose: () => {
      if (!isKept) {
        ownEnd.call(owned);
      }
    },
  });
  owned.end = () => handle.dispose();
  owned.keep = () => {
    isKept = true;
    handle.dispose();
    ownKeep.call(owned);
  };
  return owned;
}

// One dependent's view of sessions' main exports: every tool contribution,
// close guard, tool-call guard and project namer it adds, and every session it
// connects or opens, is filed under its registrations. Its `relocate` acts only
// on a session this dependent opened.
export function sessionsMainView(
  exports: SessionsMainExports,
  consumer: Registrations,
): SessionsMainExports {
  // The app ids of the sessions this view's `open` returned, until each ends
  // or is kept.
  const openedIds = new Set<string>();
  return {
    ...exports,
    contributeTools: (tools, start, options) =>
      consumer.track(exports.contributeTools(tools, start, options)),
    addCloseGuard: (mayClose, cancelHold) =>
      consumer.track(exports.addCloseGuard(mayClose, cancelHold)),
    addToolCallGuard: (guard) =>
      consumer.track(exports.addToolCallGuard(guard)),
    addProjectNamer: (namer) => consumer.track(exports.addProjectNamer(namer)),
    connect: (info) => endedWith(consumer, exports.connect(info)),
    open: (info, options) => {
      const owned = exports.open(info, options);
      const id = owned.session.id;
      openedIds.add(id);
      const ownEnd = owned.end;
      const ownKeep = owned.keep;
      // Wrapped before filing, so the dependent's stop forgets the id too.
      owned.end = () => {
        openedIds.delete(id);
        ownEnd.call(owned);
      };
      owned.keep = () => {
        openedIds.delete(id);
        ownKeep.call(owned);
      };
      return ownedWith(consumer, owned);
    },
    relocate: (sessionId, projectDir) => {
      if (!openedIds.has(sessionId)) {
        throw new Error(
          `relocate for session ${sessionId}, which this plugin did not open`,
        );
      }
      exports.relocate(sessionId, projectDir);
    },
  };
}
