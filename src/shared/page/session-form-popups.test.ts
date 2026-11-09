import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSessionFormPopups,
  type FormPopupHandle,
  type FormPopupView,
  type SessionFormPopupsDeps,
} from './session-form-popups';
import { asFake, asHtml, FakeElement, installFakeDom } from './test-dom';

// One call a fake popup handle took, in call order across every popup.
type HandleCall =
  | ['add', string, string]
  | ['setStatus', string, string]
  | ['open', string]
  | ['dispose', string];

interface AddedPopup {
  sessionId: string;
  view: FormPopupView;
  restored: boolean;
  handle: FormPopupHandle & { visible: boolean };
}

// A fake sessions `addPopup` that records each popup, its handle, and every
// handle call in `calls`, each naming the popup's session and id.
function fakeAddPopup() {
  const added: AddedPopup[] = [];
  const calls: HandleCall[] = [];
  const addPopup: SessionFormPopupsDeps['addPopup'] = (
    sessionId,
    view,
    { restored },
  ) => {
    const name = `${sessionId}/${view.id}`;
    calls.push(['add', sessionId, view.id]);
    const handle: AddedPopup['handle'] = {
      visible: false,
      setStatus: (status) => calls.push(['setStatus', name, status]),
      open: () => calls.push(['open', name]),
      isVisible: () => handle.visible,
      dispose: () => calls.push(['dispose', name]),
    };
    added.push({ sessionId, view, restored, handle });
    return handle;
  };
  return { addPopup, added, calls };
}

// Form popups over `addPopup`, recording every `formShown` call.
function popupsSetup(
  fake = fakeAddPopup(),
  popupId = 'form',
): ReturnType<typeof fakeAddPopup> & {
  popups: ReturnType<typeof createSessionFormPopups>;
  formShown: [string, boolean][];
  beforeClose: ReturnType<typeof vi.fn>;
  shown: ReturnType<typeof vi.fn>;
} {
  const formShown: [string, boolean][] = [];
  const beforeClose = vi.fn((sessionId: string) => sessionId === 'closable');
  const closesAtOnce = vi.fn((sessionId: string) => sessionId === 'kept');
  const shown = vi.fn();
  const popups = createSessionFormPopups({
    addPopup: fake.addPopup,
    popupId,
    title: 'Form',
    icon: 'checklist',
    className: 'form-tab',
    statusPartId: 'forms.status',
    closesAtOnce,
    beforeClose,
    shown,
    formShown: (sessionId, isShown) => formShown.push([sessionId, isShown]),
  });
  return { ...fake, popups, formShown, beforeClose, shown };
}

function root(): HTMLElement {
  return asHtml(new FakeElement('div'));
}

type Popups = ReturnType<typeof popupsSetup>['popups'];

describe('session form popups', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each<{
    name: string;
    before: (popups: Popups) => void;
    act: (popups: Popups) => void;
    calls: HandleCall[];
    formShown: [string, boolean][];
  }>([
    {
      name: 'a first mount adds the popup, opened by its add',
      before: () => undefined,
      act: (popups) => popups.mount('s1', root(), false),
      calls: [['add', 's1', 'form']],
      formShown: [],
    },
    {
      name: 'a mount into a held popup opens it',
      before: (popups) => popups.mount('s1', root(), false),
      act: (popups) => popups.mount('s1', root(), false),
      calls: [['open', 's1/form']],
      formShown: [],
    },
    {
      name: 'a restored mount into a held popup opens nothing',
      before: (popups) => popups.mount('s1', root(), false),
      act: (popups) => popups.mount('s1', root(), true),
      calls: [],
      formShown: [],
    },
    {
      name: 'a first status reports the form shown',
      before: (popups) => popups.mount('s1', root(), false),
      act: (popups) => popups.sync(() => 'Feature 0/2'),
      calls: [['setStatus', 's1/form', 'Feature 0/2']],
      formShown: [['s1', true]],
    },
    {
      name: 'an unchanged status sends nothing',
      before: (popups) => {
        popups.mount('s1', root(), false);
        popups.sync(() => 'Feature 0/2');
      },
      act: (popups) => popups.sync(() => 'Feature 0/2'),
      calls: [],
      formShown: [],
    },
    {
      name: 'a changed status sends it and reports nothing',
      before: (popups) => {
        popups.mount('s1', root(), false);
        popups.sync(() => 'Feature 0/2');
      },
      act: (popups) => popups.sync(() => 'Feature 1/2'),
      calls: [['setStatus', 's1/form', 'Feature 1/2']],
      formShown: [],
    },
    {
      name: 'a null status disposes a shown popup and reports it gone',
      before: (popups) => {
        popups.mount('s1', root(), false);
        popups.sync(() => 'Feature 0/2');
      },
      act: (popups) => popups.sync(() => null),
      calls: [['dispose', 's1/form']],
      formShown: [['s1', false]],
    },
    {
      name: 'a null status before any status disposes and reports nothing',
      before: (popups) => popups.mount('s1', root(), false),
      act: (popups) => popups.sync(() => null),
      calls: [['dispose', 's1/form']],
      formShown: [],
    },
  ])('$name', ({ before, act, calls, formShown }) => {
    const setup = popupsSetup();
    before(setup.popups);
    setup.calls.length = 0;
    setup.formShown.length = 0;

    act(setup.popups);

    expect(setup.calls).toEqual(calls);
    expect(setup.formShown).toEqual(formShown);
  });

  it('mounts each root into the session popup, in mount order', () => {
    const { popups, added } = popupsSetup();
    const first = root();
    const second = root();

    popups.mount('s1', first, false);
    popups.mount('s1', second, false);

    expect(added).toHaveLength(1);
    expect(added[0].view).toMatchObject({
      id: 'form',
      title: 'Form',
      icon: 'checklist',
    });
    expect(asFake(added[0].view.element).childNodes).toEqual([
      asFake(first),
      asFake(second),
    ]);
  });

  it('asks beforeClose and closesAtOnce about the popup session and passes shown on', () => {
    const { popups, added, beforeClose, shown } = popupsSetup();
    popups.mount('closable', root(), false);
    popups.mount('kept', root(), false);

    expect(added[0].view.closesAtOnce()).toBe(false);
    expect(added[1].view.closesAtOnce()).toBe(true);
    expect(added[0].view.beforeClose(true)).toBe(true);
    expect(added[1].view.beforeClose(false)).toBe(false);
    added[1].view.shown();
    expect(beforeClose.mock.calls).toEqual([
      ['closable', true],
      ['kept', false],
    ]);
    expect(shown).toHaveBeenCalledOnce();
  });

  it.each([{ restored: true }, { restored: false }])(
    'hands its add whether the first form is restored: $restored',
    ({ restored }) => {
      const { popups, added } = popupsSetup();

      popups.mount('s1', root(), restored);

      expect(added.map((popup) => popup.restored)).toEqual([restored]);
    },
  );

  it.each([
    { status: 'Feature 0/2', tooltip: 'Feature 0/2' },
    { status: '', tooltip: null },
    { status: null, tooltip: null },
  ])(
    'status part tooltip is the session status: $status',
    ({ status, tooltip }) => {
      const { popups } = popupsSetup();
      popups.mount('s1', root(), false);
      popups.sync(() => 'earlier');

      popups.sync((sessionId) => (sessionId === 's1' ? status : null));

      expect(popups.statusPart.id).toBe('forms.status');
      expect(popups.statusPart.tooltip('s1')).toBe(tooltip);
      expect(popups.statusPart.tooltip('s2')).toBeNull();
    },
  );

  it('adds a new popup for the next form once the last one left', () => {
    const { popups, calls } = popupsSetup();
    popups.mount('s1', root(), false);
    popups.sync(() => 'Feature 0/2');
    popups.sync(() => null);
    calls.length = 0;

    popups.mount('s1', root(), false);
    popups.sync(() => 'Feature 0/1');

    expect(calls).toEqual([
      ['add', 's1', 'form'],
      ['setStatus', 's1/form', 'Feature 0/1'],
    ]);
  });

  it('adds a new popup for a session it forgot, disposing nothing', () => {
    const { popups, calls } = popupsSetup();
    popups.mount('s1', root(), false);

    popups.forget('s1');
    popups.mount('s1', root(), false);

    expect(calls).toEqual([
      ['add', 's1', 'form'],
      ['add', 's1', 'form'],
    ]);
  });

  it('opens the session popup, and nothing for a session with none', () => {
    const { popups, calls } = popupsSetup();
    popups.mount('s1', root(), false);
    calls.length = 0;

    popups.open('s1');
    popups.open('s2');

    expect(calls).toEqual([['open', 's1/form']]);
  });

  it('is shown while one of its popups is the visible surface', () => {
    const { popups, added } = popupsSetup();
    popups.mount('s1', root(), false);
    popups.mount('s2', root(), false);

    expect(popups.isShown()).toBe(false);
    added[1].handle.visible = true;
    expect(popups.isShown()).toBe(true);
  });

  it('gives forms and the primer one popup each in a session, in mount order', () => {
    const fake = fakeAddPopup();
    const forms = popupsSetup(fake, 'form').popups;
    const primer = popupsSetup(fake, 'primer').popups;

    primer.mount('s1', root(), false);
    forms.mount('s1', root(), false);

    expect(fake.calls).toEqual([
      ['add', 's1', 'primer'],
      ['add', 's1', 'form'],
    ]);
  });
});
