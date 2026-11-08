import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSessionFormTabs,
  type FormTabHandle,
  type FormTabView,
} from './session-form-tabs';
import { asFake, asHtml, FakeElement, installFakeDom } from './test-dom';

interface AddedTab {
  sessionId: string;
  view: FormTabView;
  handle: FormTabHandle & {
    takeOvers: number;
    releases: number;
    visible: boolean;
  };
}

// Tabs over a fake sessions `addTab` that records each tab and its handle.
function tabsSetup() {
  const added: AddedTab[] = [];
  const beforeClose = vi.fn((sessionId: string) => sessionId === 'closable');
  const closesAtOnce = vi.fn((sessionId: string) => sessionId === 'kept');
  const shown = vi.fn();
  const formShown: [string, boolean][] = [];
  const tabs = createSessionFormTabs({
    addTab: (sessionId, view) => {
      const handle: AddedTab['handle'] = {
        takeOvers: 0,
        releases: 0,
        visible: false,
        takeOver: () => {
          handle.takeOvers++;
          return { release: () => handle.releases++ };
        },
        isVisible: () => handle.visible,
      };
      added.push({ sessionId, view, handle });
      return handle;
    },
    tabId: 'form',
    title: 'Form',
    icon: 'checklist',
    className: 'form-tab',
    idleText: 'No form open.',
    statusPartId: 'forms.status',
    closesAtOnce,
    beforeClose,
    shown,
    formShown: (sessionId, isShown) => formShown.push([sessionId, isShown]),
  });
  return { tabs, added, beforeClose, shown, formShown };
}

function root(): HTMLElement {
  return asHtml(new FakeElement('div'));
}

describe('session form tabs', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('adds one tab per session and mounts each root before the idle state', () => {
    const { tabs, added } = tabsSetup();
    const first = root();
    const second = root();

    tabs.mount('s1', first);
    tabs.mount('s1', second);

    expect(added).toHaveLength(1);
    const { view } = added[0];
    expect(view).toMatchObject({
      id: 'form',
      title: 'Form',
      icon: 'checklist',
    });
    const tab = asFake(view.element);
    expect(tab.childNodes).toHaveLength(3);
    expect(tab.childNodes[0]).toBe(asFake(first));
    expect(tab.childNodes[1]).toBe(asFake(second));
  });

  it('asks beforeClose and closesAtOnce about the tab session and passes shown on', () => {
    const { tabs, added, beforeClose, shown } = tabsSetup();
    tabs.mount('closable', root());
    tabs.mount('kept', root());

    expect(added[0].view.closesAtOnce()).toBe(false);
    expect(added[1].view.closesAtOnce()).toBe(true);
    expect(added[0].view.beforeClose(true)).toBe(true);
    expect(added[1].view.beforeClose(true)).toBe(false);
    added[1].view.shown();
    expect(beforeClose.mock.calls).toEqual([['closable'], ['kept']]);
    expect(shown).toHaveBeenCalledOnce();
  });

  it('takes over the session for a form and releases it by form id', () => {
    const { tabs, added } = tabsSetup();
    tabs.mount('s1', root());

    tabs.takeOver('f1', 's1', false);
    tabs.release('f1');
    tabs.release('f1');

    expect(added[0].handle.takeOvers).toBe(1);
    expect(added[0].handle.releases).toBe(1);
  });

  it('refuses a take over for a session with no mounted tab', () => {
    const { tabs } = tabsSetup();

    expect(() => tabs.takeOver('f1', 's1', false)).toThrow(
      'Form f1 takes over session s1, which has no mounted tab',
    );
  });

  it('shows the idle state only while the session has no status', () => {
    const { tabs, added } = tabsSetup();
    tabs.mount('s1', root());
    const idle = asFake(added[0].view.element).childNodes[1];

    tabs.sync(() => 'Feature 0/2');
    expect(idle.hidden).toBe(true);
    tabs.sync(() => null);
    expect(idle.hidden).toBe(false);
  });

  it.each([
    { status: 'Feature 0/2', tooltip: 'Feature 0/2' },
    { status: '', tooltip: null },
    { status: null, tooltip: null },
  ])(
    'status part tooltip is the session status: $status',
    ({ status, tooltip }) => {
      const { tabs } = tabsSetup();
      tabs.mount('s1', root());
      tabs.sync(() => 'earlier');

      tabs.sync((sessionId) => (sessionId === 's1' ? status : null));

      expect(tabs.statusPart.id).toBe('forms.status');
      expect(tabs.statusPart.tooltip('s1')).toBe(tooltip);
      expect(tabs.statusPart.tooltip('s2')).toBeNull();
    },
  );

  it('tells the host when a form starts or stops showing, status text aside', () => {
    const { tabs, formShown } = tabsSetup();
    tabs.mount('s1', root());
    const calls = () => formShown.splice(0);

    tabs.sync(() => null);
    expect(calls()).toEqual([]);
    tabs.sync(() => 'Feature 0/2');
    expect(calls()).toEqual([['s1', true]]);
    tabs.sync(() => 'Feature 1/2');
    expect(calls()).toEqual([]);
    tabs.sync(() => null);
    expect(calls()).toEqual([['s1', false]]);
    tabs.sync(() => '');
    expect(calls()).toEqual([['s1', true]]);
  });

  it('adds a new tab for a session it forgot', () => {
    const { tabs, added } = tabsSetup();
    tabs.mount('s1', root());

    tabs.forget('s1');
    tabs.mount('s1', root());

    expect(added.map((tab) => tab.sessionId)).toEqual(['s1', 's1']);
  });

  it('is shown while one of its tabs is the visible tab', () => {
    const { tabs, added } = tabsSetup();
    tabs.mount('s1', root());
    tabs.mount('s2', root());

    expect(tabs.isShown()).toBe(false);
    added[1].handle.visible = true;
    expect(tabs.isShown()).toBe(true);
  });
});
