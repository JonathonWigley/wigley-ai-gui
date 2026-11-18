import './tag.css';
import { element } from '../dom';

export type TagTone =
  | 'neutral'
  | 'accent'
  | 'info'
  | 'running'
  | 'success'
  | 'warning'
  | 'attention'
  | 'error';

// A small static label coloured by `tone`.
export function tag(text: string, tone: TagTone = 'neutral'): HTMLElement {
  return element('span', `ui-tag ui-tag--${tone}`, text);
}
