import { describe, expect, it } from 'vitest';
import { createListeners } from '../../../shared/listeners';
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
// added for; `removed.tell` removes a session.
function fakeExports() {
  const removed = createListeners<string>();
  const activities: [string, string, RowActivity | null][] = [];
  const disposes = { tab: 0, rowPart: 0, barPart: 0 };
  const exports: SessionsPageExports = {
    cutToTitleLimit: (text) => text,
    addTab: () => ({
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
    activate: () => undefined,
    closeSession: () => undefined,
    setActivity: (sessionId, sourceId, activity) =>
      activities.push([sessionId, sourceId, activity]),
  };
  return { exports, activities, disposes, removed };
}

describe('sessionsPageView', () => {
  it('disposes the tabs and parts a consumer added when its registrations dispose', () => {
    const { exports, disposes, removed } = fakeExports();
    const consumer = createRegistrations();
    const view = sessionsPageView(exports, consumer, removed.add);
    const part: SessionPart = { id: 'part', build: () => ({}) };

    view.addTab('s1', { id: 'tab' } as SessionTabView);
    view.addRowPart(part);
    view.addBarPart(part);
    consumer.dispose();

    expect(disposes).toEqual({ tab: 1, rowPart: 1, barPart: 1 });
  });

  it('clears each activity the consumer still holds when its registrations dispose', () => {
    const { exports, activities, removed } = fakeExports();
    const consumer = createRegistrations();
    const view = sessionsPageView(exports, consumer, removed.add);

    view.setActivity('s1', 'src', NEEDS_YOU_ACTIVITY);
    view.setActivity('s2', 'src', NEEDS_YOU_ACTIVITY);
    view.setActivity('s2', 'src', null);
    const setBefore = activities.length;
    consumer.dispose();

    expect(activities.slice(setBefore)).toEqual([['s1', 'src', null]]);
  });

  it("forgets a removed session's tabs, keeping another session's and a tab added again", () => {
    const { exports, disposes, removed } = fakeExports();
    const consumer = createRegistrations();
    const view = sessionsPageView(exports, consumer, removed.add);

    view.addTab('s1', { id: 'tab-a' } as SessionTabView);
    view.addTab('s1', { id: 'tab-b' } as SessionTabView);
    view.addTab('s2', { id: 'tab-c' } as SessionTabView);
    removed.tell('s1');
    expect(disposes.tab).toBe(2);

    view.addTab('s1', { id: 'tab-d' } as SessionTabView);
    consumer.dispose();
    expect(disposes.tab).toBe(4);
  });

  it("forgets a removed session's activities, keeping another session's", () => {
    const { exports, activities, removed } = fakeExports();
    const consumer = createRegistrations();
    const view = sessionsPageView(exports, consumer, removed.add);

    view.setActivity('s1', 'src', NEEDS_YOU_ACTIVITY);
    view.setActivity('s1', 'other', NEEDS_YOU_ACTIVITY);
    view.setActivity('s2', 'src', NEEDS_YOU_ACTIVITY);
    removed.tell('s1');
    const setBefore = activities.length;
    consumer.dispose();

    expect(activities.slice(setBefore)).toEqual([['s2', 'src', null]]);
  });
});
