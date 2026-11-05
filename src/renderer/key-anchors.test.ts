import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandArg, CommandId } from '../contracts/commands';
import type { HintWhere, ViewScope } from '../contracts/keymap';
import {
  asHtml,
  FakeElement,
  findAll,
  installFakeDom,
} from '../shared/page/test-dom';
import { createAnchors } from './key-anchors';

const LABELS: Record<CommandId, string> = { 'a.trash': 'trash' };

// A revealed registry over mutable keys and scope; `keysForCalls` records each
// keys read.
function anchorsSetup() {
  const state = {
    keys: { 'a.trash': 'd' } as Record<CommandId, string | null>,
    scope: 'a.list' as ViewScope,
  };
  const keysForCalls: [
    CommandId,
    ViewScope | undefined,
    HintWhere,
    CommandArg?,
  ][] = [];
  const anchors = createAnchors({
    keysFor: (command, scope, where, arg) => {
      keysForCalls.push(
        arg === undefined
          ? [command, scope, where]
          : [command, scope, where, arg],
      );
      return state.keys[command] ?? null;
    },
    label: (id) => LABELS[id] ?? id,
    scope: () => state.scope,
    platform: 'macos',
  });
  anchors.reveal();
  return { anchors, state, keysForCalls };
}

function unrevealedAnchors() {
  return createAnchors({
    keysFor: () => 'd',
    label: (id) => id,
    scope: () => 'a.list',
    platform: 'macos',
  });
}

function anchorElement(): FakeElement {
  return new FakeElement('span');
}

// An anchor element appended to a connected page root.
function placedElement(): FakeElement {
  const page = new FakeElement('div');
  page.isPageRoot = true;
  const node = anchorElement();
  page.append(node);
  return node;
}

function isHidden(node: FakeElement): boolean {
  return node.classList.contains('is-hint-hidden');
}

describe('createAnchors', () => {
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
    expect(node.classList.contains('ui-key-anchor')).toBe(true);
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

  it('setShown_False_HidesEveryAnchor', () => {
    const { anchors } = anchorsSetup();
    const scoped = anchorElement();
    const unscoped = anchorElement();
    anchors.anchor(asHtml(scoped), 'a.trash', { scope: 'a.list' });
    anchors.anchor(asHtml(unscoped), 'a.trash');

    anchors.setShown(false);
    const anchoredWhileOff = anchorElement();
    anchors.anchor(asHtml(anchoredWhileOff), 'a.trash');

    const nodes = [scoped, unscoped, anchoredWhileOff];
    expect(nodes.map(isHidden)).toEqual([true, true, true]);
    expect(nodes.map((node) => node.children.length)).toEqual([0, 0, 0]);
  });

  it('setShown_True_ShowsAnchorsInScopeOnly', () => {
    const { anchors } = anchorsSetup();
    const inScope = anchorElement();
    const otherScope = anchorElement();
    anchors.anchor(asHtml(inScope), 'a.trash', { scope: 'a.list' });
    anchors.anchor(asHtml(otherScope), 'a.trash', { scope: 'a.other' });

    anchors.setShown(false);
    anchors.setShown(true);

    expect(isHidden(inScope)).toBe(false);
    expect(isHidden(otherScope)).toBe(true);
    expect(inScope.textContent).toBe('d');
  });

  it('anchor_BeforeReveal_DrawsKeysAndStaysHidden', () => {
    const anchors = unrevealedAnchors();
    const node = placedElement();

    anchors.anchor(asHtml(node), 'a.trash');

    expect(node.textContent).toBe('d');
    expect(isHidden(node)).toBe(true);
    expect(anchors.placedIn('a.list')).toEqual(new Set(['a.trash']));

    anchors.reveal();

    expect(isHidden(node)).toBe(false);
  });

  it('reveal_ShownFalse_StaysHidden', () => {
    const anchors = unrevealedAnchors();
    const node = anchorElement();
    anchors.anchor(asHtml(node), 'a.trash');

    anchors.setShown(false);
    anchors.reveal();

    expect(isHidden(node)).toBe(true);
  });

  it('dispose_RemovesThePromptAndKeepsThePlacement', () => {
    const { anchors, state } = anchorsSetup();
    state.scope = 'a.detail';
    const node = placedElement();
    const handle = anchors.anchor(asHtml(node), 'a.trash', {
      scope: 'a.list',
    });

    handle.dispose();

    expect(node.children.length).toBe(0);
    expect(isHidden(node)).toBe(false);
    expect(node.classList.contains('ui-key-anchor')).toBe(false);
    expect(anchors.placedIn('a.list').has('a.trash')).toBe(true);
    state.keys['a.trash'] = 'x';
    anchors.redraw();
    expect(node.textContent).toBe('');
    expect(() => handle.dispose()).not.toThrow();
  });

  it('placedIn_ListsScopedAndUnscopedCommands', () => {
    const { anchors } = anchorsSetup();

    anchors.anchor(asHtml(placedElement()), 'a.x', { scope: 'a.s' });
    anchors.anchor(asHtml(placedElement()), 'a.y');
    anchors.anchor(asHtml(placedElement()), 'a.z', { scope: 'a.other' });

    expect(anchors.placedIn('a.s')).toEqual(new Set(['a.x', 'a.y']));
  });

  it('placedIn_NeverOnThePage_LeavesTheCommandOut', () => {
    const { anchors } = anchorsSetup();

    anchors.anchor(asHtml(anchorElement()), 'a.x', { scope: 'a.s' }).dispose();
    anchors.anchor(asHtml(anchorElement()), 'a.y');

    expect(anchors.placedIn('a.s')).toEqual(new Set());
  });

  it('placedIn_AppendedAfterTheAnchor_CountsAtTheCheck', () => {
    const { anchors } = anchorsSetup();
    const page = new FakeElement('div');
    page.isPageRoot = true;
    const node = anchorElement();
    anchors.anchor(asHtml(node), 'a.x', { scope: 'a.s' });

    page.append(node);

    expect(anchors.placedIn('a.s')).toEqual(new Set(['a.x']));
  });

  it('placedIn_OnThePageThenRemoved_KeepsThePlacement', () => {
    const { anchors } = anchorsSetup();
    const page = new FakeElement('div');
    page.isPageRoot = true;
    const node = anchorElement();
    anchors.anchor(asHtml(node), 'a.x', { scope: 'a.s' });
    page.append(node);
    anchors.applyVisibility();

    node.remove();

    expect(anchors.placedIn('a.s')).toEqual(new Set(['a.x']));
  });

  it('anchor_Arg_ReadsThatArgsKeysAndPlacesItsTarget', () => {
    const { anchors, keysForCalls } = anchorsSetup();
    const node = placedElement();

    anchors.anchor(asHtml(node), 'a.trash', { scope: 'a.s', arg: 2 });

    expect(keysForCalls.at(-1)).toEqual(['a.trash', 'a.s', 'page', 2]);
    expect(anchors.placedIn('a.s')).toEqual(new Set(['a.trash 2']));
  });
});
