import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  asFake,
  findAll,
  type FocusFakeDocument,
  FocusFakeElement,
  installFocusFakeDom,
} from '../../../shared/page/test-dom';
import type { Layout } from '../layouts/layout';
import { stashPartsSetup } from './layout/session-stash-parts.test-support';
import { createNoteDialog } from './note-dialog';

const TARGET = { sessionId: 's1', name: 'gamma' };

// A note dialog drawn through the session-stash parts (showing `mine` when
// handed in), whose `stash` records each call and whose pushed scope records
// its pushes and pops and runs its base-change listener on `baseChanged`.
// `opener` is a connected element holding focus before the dialog opens.
function dialogSetup(mine?: Layout) {
  const stashed: [string, string | null][] = [];
  let pushes = 0;
  let pops = 0;
  let onBaseChanged: (base: string) => void = () => undefined;
  const { parts } = stashPartsSetup(mine);
  const dialog = createNoteDialog({
    pushScope: () => {
      pushes += 1;
      return {
        pop: () => {
          throw new Error('the dialog closes by dispose');
        },
        dispose: () => {
          pops += 1;
        },
        onBaseChanged: (listener) => {
          onBaseChanged = listener;
          return { dispose: () => undefined };
        },
      };
    },
    stash: (sessionId, note) => {
      stashed.push([sessionId, note]);
    },
    parts,
  });
  const root = asFake(dialog.element);
  const opener = new FocusFakeElement('div');
  opener.isPageRoot = true;
  opener.focus();
  return {
    dialog,
    stashed,
    // The note box, drawn once the dialog opens.
    box: () => findAll(root, 'session-stash-box')[0] as FocusFakeElement,
    // Every body element of the given class.
    bodies: (className: string) => findAll(root, className),
    opener,
    pushes: () => pushes,
    pops: () => pops,
    baseChanged: () => onBaseChanged('idle'),
  };
}

describe('createNoteDialog', () => {
  let doc: FocusFakeDocument;

  beforeEach(() => {
    doc = installFocusFakeDom((name, value) => vi.stubGlobal(name, value));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { case: 'a note', typed: 'pick up the tests', note: 'pick up the tests' },
    { case: 'trimmed', typed: '  pick up  ', note: 'pick up' },
    { case: 'empty', typed: '', note: null },
    { case: 'spaces only', typed: '   ', note: null },
  ])('accept_TypedBox_StashesAndCloses ($case)', ({ typed, note }) => {
    const { dialog, stashed, box, pops } = dialogSetup();
    dialog.open(TARGET);
    box().value = typed;

    dialog.accept();

    expect(stashed).toEqual([['s1', note]]);
    expect(dialog.isOpen()).toBe(false);
    expect(pops()).toBe(1);
  });

  it.each([
    {
      case: 'cancel',
      close: (setup: ReturnType<typeof dialogSetup>) => setup.dialog.cancel(),
    },
    {
      case: 'base scope changed',
      close: (setup: ReturnType<typeof dialogSetup>) => setup.baseChanged(),
    },
  ])('close_WithoutAccept_StashesNothing ($case)', ({ close }) => {
    const setup = dialogSetup();
    setup.dialog.open(TARGET);
    setup.box().value = 'a note';

    close(setup);

    expect(setup.stashed).toEqual([]);
    expect(setup.dialog.isOpen()).toBe(false);
    expect(setup.pops()).toBe(1);
  });

  it.each([
    {
      case: 'accept',
      close: (setup: ReturnType<typeof dialogSetup>) => setup.dialog.accept(),
    },
    {
      case: 'cancel',
      close: (setup: ReturnType<typeof dialogSetup>) => setup.dialog.cancel(),
    },
    {
      case: 'base scope changed',
      close: (setup: ReturnType<typeof dialogSetup>) => setup.baseChanged(),
    },
  ])('close_EachWay_GivesFocusBack ($case)', ({ close }) => {
    const setup = dialogSetup();
    setup.dialog.open(TARGET);
    expect(doc.activeElement).toBe(setup.box());

    close(setup);

    expect(doc.activeElement).toBe(setup.opener);
  });

  it('close_FocusMovedElsewhereMeanwhile_KeepsIt', () => {
    const { dialog } = dialogSetup();
    dialog.open(TARGET);
    const elsewhere = new FocusFakeElement('div');
    elsewhere.isPageRoot = true;
    elsewhere.focus();

    dialog.cancel();

    expect(doc.activeElement).toBe(elsewhere);
  });

  it('open_WhileOpen_KeepsTheFirstSession', () => {
    const { dialog, stashed, pushes } = dialogSetup();
    dialog.open(TARGET);
    dialog.open({ sessionId: 's2', name: 'delta' });

    dialog.accept();

    expect(stashed).toEqual([['s1', null]]);
    expect(pushes()).toBe(1);
  });

  it('open_AfterAStash_StartsWithAnEmptyBox', () => {
    const { dialog, box } = dialogSetup();
    dialog.open(TARGET);
    box().value = 'first note';
    dialog.accept();

    dialog.open(TARGET);

    expect(box().value).toBe('');
  });

  it('open_DefaultLayout_NamesTheSession', () => {
    const { dialog, bodies } = dialogSetup();

    dialog.open(TARGET);

    expect(bodies('session-stash-session').map((n) => n.textContent)).toEqual([
      'gamma',
    ]);
  });

  it('redraw_ChangedLayout_KeepsOneBodyAndTheTypedNote', () => {
    const { dialog, box, bodies } = dialogSetup();
    dialog.open(TARGET);
    box().value = 'half typed';

    dialog.redraw();

    expect(bodies('session-stash-note')).toHaveLength(1);
    expect(box().value).toBe('half typed');
  });
});
