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

// Appends `node` to `parent`, through `moveBefore` when both are connected,
// so a frame in it stays loaded.
export function moveConnected(parent: Element, node: Node): void {
  const moving: MovingParent = parent;
  const canMoveConnected =
    typeof moving.moveBefore === 'function' &&
    parent.isConnected &&
    node.isConnected;
  if (canMoveConnected) {
    moving.moveBefore!(node, null);
  } else {
    parent.append(node);
  }
}

// A button that never takes focus, so page keys still drive the page after a
// click and Enter or Space never re-press it.
export function button(
  className: string,
  text: string,
  onClick: () => void,
): HTMLButtonElement {
  const node = element('button', className, text);
  node.type = 'button';
  node.tabIndex = -1;
  node.addEventListener('mousedown', (event) => event.preventDefault());
  node.addEventListener('click', onClick);
  return node;
}

// Blurs whatever holds focus, a text box included, so page keys fire.
export function blurFocusedElement() {
  const focused = document.activeElement;
  if (focused instanceof HTMLElement) {
    focused.blur();
  }
}
