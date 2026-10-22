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

// `html` comes from the MarkdownRenderer, which escapes everything it is given.
export function markdownElement(
  tag: 'div' | 'span',
  className: string,
  html: string,
): HTMLElement {
  const node = element(tag, className);
  node.innerHTML = html;
  return node;
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

// Shows `keys`, the keys that run a control's command, after `control`'s
// label and returns the hint; nothing and null when the command is unbound
// (null).
export function appendKeys(
  control: HTMLElement,
  keys: string | null,
): HTMLElement | null {
  if (keys === null) {
    return null;
  }
  const hint = element('kbd', 'key-hint', keys);
  control.append(hint);
  return hint;
}

// Shows `keys` at the end of `control` in place of `hint`, the hint shown
// there now, and returns the hint shown after; null when `keys` is null. Keys
// that read as `hint` already does leave it in place.
export function showKeys(
  control: HTMLElement,
  hint: HTMLElement | null,
  keys: string | null,
): HTMLElement | null {
  if ((hint?.textContent ?? null) === keys) {
    return hint;
  }
  hint?.remove();
  return appendKeys(control, keys);
}
