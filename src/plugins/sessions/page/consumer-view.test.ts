import { describe, expect, it } from 'vitest';
import { createRegistrations } from '../../../shared/registrations';
import {
  NEEDS_YOU_ACTIVITY,
  type RowActivity,
  type SessionPart,
  type SessionsPageExports,
  type SessionTabView,
} from '../contract';
import { sessionsPageView } from './consumer-view';

// Records `setActivity` calls and counts each handle's disposes, by what it was
// added for.
function fakeExports() {
  const activities: [string, string, RowActivity | null][] = [];
  const disposes = { tab: 0, rowPart: 0, barPart: 0 };
  const exports: SessionsPageExports = {
    addTab: () => ({
      setStatus: () => undefined,
      select: () => undefined,
      takeOver: () => ({ release: () => undefined }),
      isVisible: () => false,
      dispose: () => {
        disposes.tab++;
      },
    }),
    addRowPart: () => ({
      dispose: () => {
        disposes.rowPart++;
      },
    }),
    addBarPart: () => ({
      dispose: () => {
        disposes.barPart++;
      },
    }),
    selectedSessionId: () => null,
    activate: () => undefined,
    closeSession: () => undefined,
    setActivity: (sessionId, sourceId, activity) =>
      activities.push([sessionId, sourceId, activity]),
  };
  return { exports, activities, disposes };
}

describe('sessionsPageView', () => {
  it('disposes the tabs and parts a consumer added when its registrations dispose', () => {
    const { exports, disposes } = fakeExports();
    const consumer = createRegistrations();
    const view = sessionsPageView(exports, consumer);
    const part: SessionPart = { id: 'part', build: () => ({}) };

    view.addTab('s1', { id: 'tab' } as SessionTabView);
    view.addRowPart(part);
    view.addBarPart(part);
    consumer.dispose();

    expect(disposes).toEqual({ tab: 1, rowPart: 1, barPart: 1 });
  });

  it('clears each activity the consumer still holds when its registrations dispose', () => {
    const { exports, activities } = fakeExports();
    const consumer = createRegistrations();
    const view = sessionsPageView(exports, consumer);

    view.setActivity('s1', 'src', NEEDS_YOU_ACTIVITY);
    view.setActivity('s2', 'src', NEEDS_YOU_ACTIVITY);
    view.setActivity('s2', 'src', null);
    const setBefore = activities.length;
    consumer.dispose();

    expect(activities.slice(setBefore)).toEqual([['s1', 'src', null]]);
  });
});
