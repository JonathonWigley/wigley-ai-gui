// Builds an element with its class and, when given, its text.
export function element<Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  className = '',
  text?: string,
): HTMLElementTagNameMap[Tag] {
  const node = document.createElement(tag);
  if (className !== '') {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

// Appends `node` to `parent` and returns it, as every kit part does.
export function appended<E extends HTMLElement>(
  parent: HTMLElement,
  node: E,
): E {
  parent.append(node);
  return node;
}

// lib.dom declares `moveBefore` only on Document.
type MovingParent = Element & {
  moveBefore?(node: Node, child: Node | null): void;
};

// Inserts `node` into `parent` before `before`, a child of `parent` (at the
// end when null), through `moveBefore` when both are connected, so a frame in
// it stays loaded.
export function moveConnected(
  parent: Element,
  node: Node,
  before: Node | null = null,
): void {
  const moving: MovingParent = parent;
  const canMoveConnected =
    typeof moving.moveBefore === 'function' &&
    parent.isConnected &&
    node.isConnected;
  if (canMoveConnected) {
    moving.moveBefore!(node, before);
  } else {
    parent.insertBefore(node, before);
  }
}

// A link the markdown renderer drew, whose click the page core opens.
export const RENDERED_LINK = 'a.md-link[data-href]';

// A button that never takes focus, so page keys still drive the page after a
// click and Enter or Space never re-press it. A click on a rendered link inside
// it opens the link alone.
export function button(
  className: string,
  text: string,
  onClick: () => void,
): HTMLButtonElement {
  const node = element('button', className, text);
  node.type = 'button';
  node.tabIndex = -1;
  node.addEventListener('mousedown', (event) => event.preventDefault());
  node.addEventListener('click', (event) => {
    const isOnLink = (event.target as Element).closest(RENDERED_LINK) !== null;
    if (!isOnLink) {
      onClick();
    }
  });
  return node;
}

// Input types that take no typed text, so focus in one leaves no field the
// user is typing in.
const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

// Whether `element` is a field the user types in: a text-taking input, a
// textarea, or contenteditable content such as an editor.
export function holdsTextEntry(element: Element | null): boolean {
  const field = element as HTMLElement | null;
  const isTextInput =
    field?.tagName === 'INPUT' &&
    !NON_TEXT_INPUT_TYPES.has((field as HTMLInputElement).type);
  return (
    isTextInput ||
    field?.tagName === 'TEXTAREA' ||
    field?.isContentEditable === true
  );
}

// Takes focus off whatever holds it, a text box or a frame included, so page
// keys fire: a frame through `focusOutOfFrame`, anything else by its `blur`.
export function blurFocusedElement() {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement)) {
    return;
  }
  if (focused.tagName === 'IFRAME') {
    focusOutOfFrame(focused as HTMLIFrameElement);
  } else {
    focused.blur();
  }
}

// Moves keyboard focus out of `frame` to the page: to the nearest ancestor
// holding a `tabindex` that takes it, else to the body. A frame whose document
// holds focus stays the page's active element through its own `blur`.
export function focusOutOfFrame(frame: HTMLIFrameElement) {
  for (
    let node = frame.parentElement;
    node !== null;
    node = node.parentElement
  ) {
    if (node.hasAttribute('tabindex')) {
      node.focus({ preventScroll: true });
      if (document.activeElement === node) {
        return;
      }
    }
  }
  const { body } = document;
  body.tabIndex = -1;
  body.focus({ preventScroll: true });
  body.removeAttribute('tabindex');
}
