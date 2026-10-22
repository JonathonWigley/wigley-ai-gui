// The one module naming the icon font: Codicons, sized by `icon-size`.
import '@vscode/codicons/dist/codicon.css';
import './icon.css';
import { element } from '../dom';

// A Codicon by its name (`book` draws `codicon-book`), hidden from assistive
// technology, since the control holding it carries the label.
export function icon(name: string): HTMLElement {
  const node = element('span', `codicon codicon-${name}`);
  node.setAttribute('aria-hidden', 'true');
  return node;
}
