import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  blurFocusedElement,
  button,
  focusOutOfFrame,
  moveConnected,
  RENDERED_LINK,
} from './dom';
import { installMarkdownDom } from './markdown-mount.test-support';
import { asFake, installFakeDom } from './test-dom';

describe('button', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { case: 'on the button', isOnLink: false, isPressed: true },
    { case: 'on a rendered link inside it', isOnLink: true, isPressed: false },
  ])('click $case presses it: $isPressed', ({ isOnLink, isPressed }) => {
    installFakeDom(vi.stubGlobal);
    const onClick = vi.fn();
    const node = asFake(button('pick', 'Pick', onClick));
    const target = {
      closest: (selector: string) =>
        isOnLink && selector === RENDERED_LINK ? {} : null,
    };

    node.fire('click', { target });

    expect(onClick).toHaveBeenCalledTimes(isPressed ? 1 : 0);
  });
});

describe('moveConnected', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { case: 'both are connected', parent: true, node: true, isMoved: true },
    { case: 'the parent is not connected', parent: false, node: true },
    { case: 'the node is not connected', parent: true, node: false },
    {
      case: 'both are connected, before a child',
      parent: true,
      node: true,
      isMoved: true,
      isBeforeKept: true,
    },
    {
      case: 'the parent is not connected, before a child',
      parent: false,
      node: true,
      isBeforeKept: true,
    },
    {
      case: 'the node is not connected, before a child',
      parent: true,
      node: false,
      isBeforeKept: true,
    },
  ])(
    'inserts the node, through moveBefore only when $case',
    ({
      parent: isParentConnected,
      node: isNodeConnected,
      isMoved = false,
      isBeforeKept = false,
    }) => {
      const { moves } = installMarkdownDom((name, value) =>
        vi.stubGlobal(name, value),
      );
      const from = document.createElement('div');
      const to = document.createElement('div');
      const kept = document.createElement('div');
      const node = document.createElement('div');
      asFake(from).isPageRoot = isNodeConnected;
      asFake(to).isPageRoot = isParentConnected;
      to.append(kept);
      from.append(node);

      if (isBeforeKept) {
        moveConnected(to, node, kept);
      } else {
        moveConnected(to, node);
      }

      expect(asFake(to).childNodes).toEqual(
        isBeforeKept
          ? [asFake(node), asFake(kept)]
          : [asFake(kept), asFake(node)],
      );
      expect(moves).toEqual(
        isMoved ? [{ element: asFake(node), to: asFake(to) }] : [],
      );
    },
  );
});

interface FocusState {
  activeElement: FocusNode | null;
}

// An element as focus sees it: it takes focus only while it holds a
// `tabindex`, as a browser's `div` and `body` do, unless `refuses` is set, as
// for a hidden one. Its tag is its `name`.
class FocusNode {
  readonly attributes: Set<string>;
  private readonly refuses: boolean;

  constructor(
    private readonly focusState: FocusState,
    readonly name: string,
    readonly parentElement: FocusNode | null,
    { tabindex = false, refuses = false } = {},
  ) {
    this.attributes = new Set(tabindex ? ['tabindex'] : []);
    this.refuses = refuses;
  }

  get tagName(): string {
    return this.name.toUpperCase();
  }

  set tabIndex(_value: number) {
    this.attributes.add('tabindex');
  }

  get tabIndex(): number {
    return -1;
  }

  hasAttribute(attribute: string): boolean {
    return this.attributes.has(attribute);
  }

  removeAttribute(attribute: string) {
    this.attributes.delete(attribute);
  }

  focus() {
    if (!this.refuses && this.attributes.has('tabindex')) {
      this.focusState.activeElement = this;
    }
  }

  blur() {
    if (this.focusState.activeElement === this) {
      this.focusState.activeElement = null;
    }
  }
}

// Builds `ancestors`, from the body inward, around a focused `focused` node,
// and stubs the document and `HTMLElement` over them.
function focusTree(
  ancestors: { name: string; tabindex?: boolean; refuses?: boolean }[],
  focused: string,
) {
  const state: FocusState = { activeElement: null };
  const body = new FocusNode(state, 'body', null);
  let parent = body;
  for (const { name, ...options } of ancestors) {
    parent = new FocusNode(state, name, parent, options);
  }
  const node = new FocusNode(state, focused, parent, { tabindex: true });
  node.focus();
  vi.stubGlobal('HTMLElement', FocusNode);
  vi.stubGlobal('document', {
    body,
    get activeElement() {
      return state.activeElement;
    },
  });
  return { state, body, node };
}

describe('focusOutOfFrame', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Each row is the frame's ancestors from the body inward, with the ancestor
  // focus lands on.
  it.each([
    {
      case: 'nearest ancestor holding a tabindex',
      ancestors: [
        { name: 'pane', tabindex: true },
        { name: 'list', tabindex: true },
        { name: 'entry' },
      ],
      focused: 'list',
    },
    {
      case: 'next one up when the nearest refuses focus',
      ancestors: [
        { name: 'pane', tabindex: true },
        { name: 'list', tabindex: true, refuses: true },
        { name: 'entry' },
      ],
      focused: 'pane',
    },
    {
      case: 'body when no ancestor holds a tabindex',
      ancestors: [{ name: 'pane' }, { name: 'entry' }],
      focused: 'body',
    },
  ])('moves focus off the frame to the $case', ({ ancestors, focused }) => {
    const { state, body, node } = focusTree(ancestors, 'iframe');

    focusOutOfFrame(node as unknown as HTMLIFrameElement);

    expect(state.activeElement?.name).toBe(focused);
    expect(body.hasAttribute('tabindex')).toBe(false);
  });
});

describe('blurFocusedElement', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { case: 'a frame, to its ancestor', focused: 'iframe', after: 'pane' },
    { case: 'a text box, to nothing', focused: 'input', after: undefined },
  ])('takes focus off $case', ({ focused, after }) => {
    const { state } = focusTree(
      [{ name: 'pane', tabindex: true }, { name: 'entry' }],
      focused,
    );

    blurFocusedElement();

    expect(state.activeElement?.name).toBe(after);
  });
});
