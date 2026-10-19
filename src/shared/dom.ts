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
