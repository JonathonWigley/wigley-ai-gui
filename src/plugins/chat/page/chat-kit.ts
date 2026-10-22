import type { ChatEntry } from '../../../contracts/agent';
import type { Disposable } from '../../../contracts/disposable';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type { Platform } from '../../../contracts/platform';
import { element, markdownElement } from '../../../shared/page/dom';
import { textButton } from '../../../shared/page/ui/button';
import {
  type CollapsibleCard,
  card,
  createCollapsibleCard,
} from '../../../shared/page/ui/card';
import { sectionHeader } from '../../../shared/page/ui/section-header';
import { setDotStatus, statusDot } from '../../../shared/page/ui/status-dot';
import type { KeysPageExports } from '../../keys/contract';
import type { ChatKit } from '../layouts/layout';
import type { PermissionEntry } from './chat-state';
import { keyHint } from './key-hint';

// `allow` answers the permission entry allowed; `deny` opens the reason box
// for it. `platform` prints the key hints.
export interface KitDeps {
  markdown: MarkdownRenderer;
  keys: Pick<KeysPageExports, 'keysFor' | 'onChanged'>;
  platform: Platform;
  allow(entry: PermissionEntry): void;
  deny(entry: PermissionEntry): void;
}

// The expanders one kit made (its expanders and collapsible cards), in
// creation order.
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

type Expander = Pick<CollapsibleCard, 'isOpen' | 'setOpen'>;

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
      return kit.collapsibleCard({ summary, body }).element;
    },
    collapsibleCard(options) {
      const built = createCollapsibleCard(options);
      expanders.push(built);
      return built;
    },
    card,
    statusDot,
    setDotStatus,
    sectionHeader: (text) => sectionHeader(text),
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
      isAnyClosed: () => expanders.some((expander) => !expander.isOpen()),
      setAllOpen(open) {
        for (const expander of expanders) {
          expander.setOpen(open);
        }
      },
      openStates: () => expanders.map((expander) => expander.isOpen()),
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

// Allow once and Deny with the keys bound to them now, or the answer once
// the entry carries one.
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
  const allow = textButton('Allow once', () => deps.allow(entry), {
    variant: 'primary',
    hint: keyHint(deps.keys, deps.platform, 'allowPermission', 'chat'),
  });
  const deny = textButton('Deny', () => deps.deny(entry), {
    variant: 'secondary',
    hint: keyHint(deps.keys, deps.platform, 'denyPermission', 'chat'),
  });
  part.replaceChildren(allow, deny);
}

function answerText(answer: NonNullable<PermissionEntry['answer']>): string {
  if (answer.allowed) {
    return 'Allowed once';
  }
  return answer.reason === null ? 'Denied' : `Denied: ${answer.reason}`;
}
