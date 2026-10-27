import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandId } from '../../../contracts/commands';
import type { ViewScope } from '../../../contracts/keymap';
import {
  asHtml,
  FakeElement,
  findAll,
  installFakeDom,
} from '../../../shared/page/test-dom';
import type { HintWhere } from '../contract';
import { createAnchors } from './anchors';

const LABELS: Record<CommandId, string> = { 'a.trash': 'trash' };

// A registry over mutable keys, scope and hint setting; `keysForCalls`
// records each keys read.
function anchorsSetup() {
  const state = {
    keys: { 'a.trash': 'd' } as Record<CommandId, string | null>,
    scope: 'a.list' as ViewScope,
    showHints: true,
  };
  const keysForCalls: [CommandId, ViewScope | undefined, HintWhere][] = [];
  const anchors = createAnchors({
    keysFor: (command, scope, where) => {
      keysForCalls.push([command, scope, where]);
      return state.keys[command] ?? null;
    },
    label: (id) => LABELS[id] ?? id,
    scope: () => state.scope,
    showHints: () => state.showHints,
    platform: 'macos',
  });
  return { anchors, state, keysForCalls };
}

function anchorElement(): FakeElement {
  return new FakeElement('span');
}

function isHidden(node: FakeElement): boolean {
  return node.classList.contains('is-hint-hidden');
}

describe('anchors', () => {
  beforeEach(() => installFakeDom((name, value) => vi.stubGlobal(name, value)));
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('anchor_Bound_DrawsTheKeyPrompt', () => {
    const { anchors } = anchorsSetup();
    const node = anchorElement();

    anchors.anchor(asHtml(node), 'a.trash');

    expect(node.textContent).toBe('d');
    expect(findAll(node, 'ui-key-prompt')).toHaveLength(1);
  });

  it('anchor_LabelTrue_DrawsTheCommandLabelAfterTheKeys', () => {
    const { anchors } = anchorsSetup();
    const node = anchorElement();

    anchors.anchor(asHtml(node), 'a.trash', { label: true });

    expect(node.textContent).toBe('dtrash');
    expect(findAll(node, 'ui-key-prompt-label')[0].textContent).toBe('trash');
  });

  it('anchor_LabelString_DrawsThatText', () => {
    const { anchors } = anchorsSetup();
    const node = anchorElement();

    anchors.anchor(asHtml(node), 'a.trash', { label: 'remove' });

    expect(node.textContent).toBe('dremove');
  });

  it('anchor_Unbound_DrawsNothing', () => {
    const { anchors, state } = anchorsSetup();
    state.keys['a.trash'] = null;
    const node = anchorElement();

    anchors.anchor(asHtml(node), 'a.trash', { label: true });

    expect(node.children.length).toBe(0);
  });

  it('anchor_ScopeAndWhere_ReadsKeysThere', () => {
    const { anchors, keysForCalls } = anchorsSetup();

    anchors.anchor(asHtml(anchorElement()), 'a.trash', {
      scope: 'a.list',
      where: 'box',
    });
    anchors.anchor(asHtml(anchorElement()), 'a.trash');

    expect(keysForCalls).toEqual([
      ['a.trash', 'a.list', 'box'],
      ['a.trash', undefined, 'page'],
    ]);
  });

  it('redraw_KeysChanged_DrawsTheNewKeys', () => {
    const { anchors, state } = anchorsSetup();
    const node = anchorElement();
    anchors.anchor(asHtml(node), 'a.trash');

    state.keys['a.trash'] = 'x';
    anchors.redraw();
    expect(node.textContent).toBe('x');

    state.keys['a.trash'] = null;
    anchors.redraw();
    expect(node.textContent).toBe('');
  });

  it('applyVisibility_OtherScope_HidesAndKeepsThePrompt', () => {
    const { anchors, state } = anchorsSetup();
    state.scope = 'a.detail';
    const node = anchorElement();

    anchors.anchor(asHtml(node), 'a.trash', { scope: 'a.list' });

    expect(isHidden(node)).toBe(true);
    expect(node.textContent).toBe('d');
  });

  it('applyVisibility_ScopeInForce_Shows', () => {
    const { anchors, state } = anchorsSetup();
    state.scope = 'a.detail';
    const node = anchorElement();
    anchors.anchor(asHtml(node), 'a.trash', { scope: 'a.list' });

    state.scope = 'a.list';
    anchors.applyVisibility();

    expect(isHidden(node)).toBe(false);
  });

  it('anchor_NoScope_ShowsInEveryScope', () => {
    const { anchors, state } = anchorsSetup();
    const node = anchorElement();
    anchors.anchor(asHtml(node), 'a.trash');
    expect(isHidden(node)).toBe(false);

    state.scope = 'b.other';
    anchors.applyVisibility();

    expect(isHidden(node)).toBe(false);
  });

  it('applyVisibility_ShowHintsOff_HidesEveryAnchor', () => {
    const { anchors, state } = anchorsSetup();
    const scoped = anchorElement();
    const unscoped = anchorElement();
    anchors.anchor(asHtml(scoped), 'a.trash', { scope: 'a.list' });
    anchors.anchor(asHtml(unscoped), 'a.trash');

    state.showHints = false;
    anchors.applyVisibility();

    expect(isHidden(scoped)).toBe(true);
    expect(isHidden(unscoped)).toBe(true);
  });

  it('dispose_RemovesThePromptAndKeepsThePlacement', () => {
    const { anchors, state } = anchorsSetup();
    state.scope = 'a.detail';
    const node = anchorElement();
    const handle = anchors.anchor(asHtml(node), 'a.trash', {
      scope: 'a.list',
    });

    handle.dispose();

    expect(node.children.length).toBe(0);
    expect(isHidden(node)).toBe(false);
    expect(anchors.placedIn('a.list').has('a.trash')).toBe(true);
    state.keys['a.trash'] = 'x';
    anchors.redraw();
    expect(node.textContent).toBe('');
    expect(() => handle.dispose()).not.toThrow();
  });

  it('placedIn_ListsScopedAndUnscopedCommands', () => {
    const { anchors } = anchorsSetup();

    anchors.anchor(asHtml(anchorElement()), 'a.x', { scope: 'a.s' });
    anchors.anchor(asHtml(anchorElement()), 'a.y');
    anchors.anchor(asHtml(anchorElement()), 'a.z', { scope: 'a.other' });

    expect(anchors.placedIn('a.s')).toEqual(new Set(['a.x', 'a.y']));
  });
});
