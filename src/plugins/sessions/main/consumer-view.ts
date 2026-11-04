import type { Registrations } from '../../../contracts/disposable';
import type { SessionsMainExports } from '../contract';

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

// One dependent's view of sessions' main exports: every tool contribution and
// close guard it adds, and every session it connects or opens, is filed under
// its registrations.
export function sessionsMainView(
  exports: SessionsMainExports,
  consumer: Registrations,
): SessionsMainExports {
  return {
    ...exports,
    contributeTools: (tools, start) =>
      consumer.track(exports.contributeTools(tools, start)),
    addCloseGuard: (mayClose) =>
      consumer.track(exports.addCloseGuard(mayClose)),
    connect: (info) => endedWith(consumer, exports.connect(info)),
    open: (info, options) => endedWith(consumer, exports.open(info, options)),
  };
}
