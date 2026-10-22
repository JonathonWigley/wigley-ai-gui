import type { ChatEntry } from '../../../contracts/agent';
import type { Disposable } from '../../../contracts/disposable';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import {
  appendKeys,
  button,
  element,
  markdownElement,
} from '../../../shared/page/dom';
import type { KeysPageExports } from '../../keys/contract';
import { chatCommand, chatScope } from '../ids';
import type { ChatKit } from '../layouts/layout';
import type { PermissionEntry } from './chat-state';

// `allow` answers the permission entry allowed; `deny` opens the reason box
// for it.
export interface KitDeps {
  markdown: MarkdownRenderer;
  keys: Pick<KeysPageExports, 'keysFor' | 'onChanged'>;
  allow(entry: PermissionEntry): void;
  deny(entry: PermissionEntry): void;
}

// The expanders one kit made, in creation order.
export interface Expanders {
  count(): number;
  isAnyClosed(): boolean;
  setAllOpen(open: boolean): void;
  openStates(): boolean[];
  // Opens each expander whose creation-order place is open in `states`.
  restore(states: readonly boolean[]): void;
}

// One built entry's kit: the parts the layout drew from it, kept up to date by
// `update` with each later version of the entry and, while a permission
// entry waits for its answer, with each keymap change. `dispose` stops the
// kit following keymap changes; its owner calls it when it drops the kit.
export interface EntryKit {
  kit: ChatKit;
  update(entry: ChatEntry): void;
  expanders: Expanders;
  dispose(): void;
}

interface Expander {
  isOpen: boolean;
  setOpen(open: boolean): void;
}

export function createEntryKit(entry: ChatEntry, deps: KitDeps): EntryKit {
  let current = entry;
  const expanders: Expander[] = [];
  const permissionParts: HTMLElement[] = [];
  // Set while an unanswered permission entry's actions show keys.
  let keysChange: Disposable | null = null;
  const drawPermissionParts = () => {
    if (current.kind !== 'permission') {
      return;
    }
    for (const part of permissionParts) {
      drawPermissionActions(part, current, deps);
    }
    const isAnswered = current.answer !== null;
    if (isAnswered) {
      keysChange?.dispose();
      keysChange = null;
    } else {
      keysChange ??= deps.keys.onChanged(drawPermissionParts);
    }
  };
  const kit: ChatKit = {
    markdown: (text) => markdownElement('div', 'md', deps.markdown.block(text)),
    json: (value) =>
      element('pre', 'chat-json', String(JSON.stringify(value, null, 2))),
    expander(summary, body) {
      const built = buildExpander(summary, body);
      expanders.push(built.expander);
      return built.element;
    },
    permissionActions() {
      if (current.kind !== 'permission') {
        throw new Error('permissionActions is only for a permission entry');
      }
      const part = element('div', 'chat-permission-actions');
      permissionParts.push(part);
      drawPermissionParts();
      return part;
    },
  };
  return {
    kit,
    update(next) {
      current = next;
      drawPermissionParts();
    },
    dispose() {
      keysChange?.dispose();
      keysChange = null;
    },
    expanders: {
      count: () => expanders.length,
      isAnyClosed: () => expanders.some((expander) => !expander.isOpen),
      setAllOpen(open) {
        for (const expander of expanders) {
          expander.setOpen(open);
        }
      },
      openStates: () => expanders.map((expander) => expander.isOpen),
      restore(states) {
        expanders.forEach((expander, index) => {
          if (states[index] === true) {
            expander.setOpen(true);
          }
        });
      },
    },
  };
}

// A line that toggles `body()`'s element under it; `body` runs on each open,
// its element replacing the last.
function buildExpander(
  summary: string,
  body: () => HTMLElement,
): { element: HTMLElement; expander: Expander } {
  const root = element('div', 'chat-expander');
  const marker = element('span', 'chat-expander-marker', '▸');
  const line = button('chat-expander-line', '', () =>
    expander.setOpen(!expander.isOpen),
  );
  line.append(marker, element('span', 'chat-expander-summary', summary));
  root.append(line);
  let shownBody: HTMLElement | null = null;
  const expander: Expander = {
    isOpen: false,
    setOpen(open) {
      if (open === expander.isOpen) {
        return;
      }
      expander.isOpen = open;
      marker.textContent = open ? '▾' : '▸';
      shownBody?.remove();
      shownBody = open ? body() : null;
      if (shownBody !== null) {
        root.append(shownBody);
      }
    },
  };
  return { element: root, expander };
}

function drawPermissionActions(
  part: HTMLElement,
  entry: PermissionEntry,
  deps: KitDeps,
) {
  if (entry.answer !== null) {
    part.replaceChildren(
      element('span', 'chat-permission-answer', answerText(entry.answer)),
    );
    return;
  }
  const allow = button('button button-primary', 'Allow', () =>
    deps.allow(entry),
  );
  appendKeys(
    allow,
    deps.keys.keysFor(chatCommand('allowPermission'), chatScope('chat')),
  );
  const deny = button('button', 'Deny', () => deps.deny(entry));
  appendKeys(
    deny,
    deps.keys.keysFor(chatCommand('denyPermission'), chatScope('chat')),
  );
  part.replaceChildren(allow, deny);
}

function answerText(answer: NonNullable<PermissionEntry['answer']>): string {
  if (answer.allowed) {
    return 'Allowed';
  }
  return answer.reason === null ? 'Denied' : `Denied: ${answer.reason}`;
}
