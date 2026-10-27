import type { ChatEntry, ChatImage } from '../../../contracts/agent';
import type { Disposable } from '../../../contracts/disposable';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import { element, markdownElement } from '../../../shared/page/dom';
import { type ButtonVariant, textButton } from '../../../shared/page/ui/button';
import {
  type CollapsibleCard,
  card,
  createCollapsibleCard,
} from '../../../shared/page/ui/card';
import { sectionHeader } from '../../../shared/page/ui/section-header';
import { setDotStatus, statusDot } from '../../../shared/page/ui/status-dot';
import type { KeysPageExports } from '../../keys/contract';
import { type ChatCommandName, chatCommand, chatScope } from '../ids';
import type { ChatKit } from '../layouts/layout';
import { imageUrl } from './attachments';
import type { PermissionEntry } from './chat-state';

// `allow` answers the permission entry allowed; `deny` opens the reason box
// for it. `keys` anchors the permission actions' key hints. `openImages`
// opens the image viewer on a user entry's images at `index`.
export interface KitDeps {
  markdown: MarkdownRenderer;
  keys: Pick<KeysPageExports, 'anchor'>;
  allow(entry: PermissionEntry): void;
  deny(entry: PermissionEntry): void;
  openImages(images: readonly ChatImage[], index: number): void;
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
// `update` with each later version of the entry. `dispose` disposes the key
// anchors a waiting permission entry's actions still hold; its owner calls it
// when it drops the kit.
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
  const permissionParts: PermissionPart[] = [];
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
      const part = createPermissionPart(current, deps);
      permissionParts.push(part);
      return part.element;
    },
    images() {
      if (current.kind !== 'user') {
        throw new Error('images is only for a user entry');
      }
      return imageThumbnails(current.images, deps);
    },
  };
  return {
    kit,
    update(next) {
      current = next;
      if (next.kind === 'permission') {
        for (const part of permissionParts) {
          part.draw(next);
        }
      }
    },
    dispose() {
      for (const part of permissionParts) {
        part.dispose();
      }
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

// One permission entry's actions. `draw` takes each later version of the
// entry; `dispose` disposes the anchors still held.
interface PermissionPart {
  element: HTMLElement;
  draw(entry: PermissionEntry): void;
  dispose(): void;
}

// Allow once and Deny, built once, each with its keys anchored in the Chat
// tab's scope; once the entry carries its answer, the answer text, the two
// anchors disposed.
function createPermissionPart(
  entry: PermissionEntry,
  deps: KitDeps,
): PermissionPart {
  const part = element('div', 'chat-permission-actions');
  let current = entry;
  let anchors: Disposable[] = [];
  const actionButton = (
    label: string,
    variant: ButtonVariant,
    command: ChatCommandName,
    act: (answered: PermissionEntry) => void,
  ) => {
    const hint = element('span', 'chat-permission-key');
    anchors.push(
      deps.keys.anchor(hint, chatCommand(command), {
        scope: chatScope('chat'),
      }),
    );
    return textButton(label, () => act(current), { variant, hint });
  };
  const disposeAnchors = () => {
    for (const anchor of anchors) {
      anchor.dispose();
    }
    anchors = [];
  };
  const draw = (next: PermissionEntry) => {
    current = next;
    if (next.answer !== null) {
      disposeAnchors();
      part.replaceChildren(
        element('span', 'chat-permission-answer', answerText(next.answer)),
      );
    }
  };
  if (entry.answer === null) {
    part.append(
      actionButton('Allow once', 'primary', 'allowPermission', (answered) =>
        deps.allow(answered),
      ),
      actionButton('Deny', 'secondary', 'denyPermission', (answered) =>
        deps.deny(answered),
      ),
    );
  }
  draw(entry);
  return { element: part, draw, dispose: disposeAnchors };
}

// One thumbnail per image, each opening the viewer at its own index.
function imageThumbnails(
  images: readonly ChatImage[],
  deps: Pick<KitDeps, 'openImages'>,
): HTMLElement {
  const strip = element('div', 'chat-images');
  strip.append(
    ...images.map((image, index) => {
      const thumbnail = element('img', 'chat-image-thumbnail');
      thumbnail.src = imageUrl(image);
      thumbnail.alt = `Image ${index + 1} of ${images.length}`;
      thumbnail.addEventListener('click', () => deps.openImages(images, index));
      return thumbnail;
    }),
  );
  return strip;
}

function answerText(answer: NonNullable<PermissionEntry['answer']>): string {
  if (answer.allowed) {
    return 'Allowed once';
  }
  return answer.reason === null ? 'Denied' : `Denied: ${answer.reason}`;
}
