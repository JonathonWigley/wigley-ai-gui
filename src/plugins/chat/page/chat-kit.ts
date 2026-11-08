import type { ChatEntry, ChatImage } from '../../../contracts/agent';
import type { Disposable } from '../../../contracts/disposable';
import { formatTokens } from '../../../shared/format-tokens';
import { appended, element } from '../../../shared/page/dom';
import { type ButtonVariant, textButton } from '../../../shared/page/ui/button';
import {
  type CollapsibleCard,
  type CollapsibleCardOptions,
  card,
  createCollapsibleCard,
} from '../../../shared/page/ui/card';
import { disposeAnchors } from '../../../shared/page/ui/key-anchors';
import { type ChatCommandName, chatCommand, chatScope } from '../ids';
import type { ChatKit } from '../layouts/layout';
import { imageUrl } from './attachments';
import { type SurfaceKitDeps, surfaceBaseKit } from './chat-layouts';
import type { PermissionEntry } from './chat-state';

// `allow` answers the permission entry allowed; `deny` opens the reason box
// for it. `keys` also anchors the permission actions' key hints.
// `openImages` opens the image viewer on a user entry's images at `index`.
export interface KitDeps extends SurfaceKitDeps {
  allow(entry: PermissionEntry): void;
  deny(entry: PermissionEntry): void;
  openImages(images: readonly ChatImage[], index: number): void;
}

// One of a kit's expanders: a collapsible card or row, or an expander.
export type Expander = Pick<CollapsibleCard, 'element' | 'isOpen' | 'setOpen'>;

// The expanders one kit made (its expanders, collapsible cards and rows), in
// creation order.
export interface Expanders {
  count(): number;
  isAnyClosed(): boolean;
  setAllOpen(open: boolean): void;
  openStates(): boolean[];
  // Opens each expander whose creation-order place is open in `states`.
  restore(states: readonly boolean[]): void;
  // The expanders whose element `container` contains, in creation order.
  inside(container: HTMLElement): Expander[];
}

// One built entry's kit: the parts the layout drew from it, kept up to date by
// `update` with each later version of the entry. `dispose` disposes the key
// anchors the base kit's parts named and those a waiting permission entry's
// actions still hold; its owner calls it when it drops the kit.
export interface EntryKit {
  kit: ChatKit;
  update(entry: ChatEntry): void;
  expanders: Expanders;
  dispose(): void;
}

// The base kit, its key hints anchored in the Chat tab's scope, under chat's
// own parts.
export function createEntryKit(entry: ChatEntry, deps: KitDeps): EntryKit {
  let current = entry;
  const expanders: Expander[] = [];
  const permissionParts: PermissionPart[] = [];
  const anchors: Disposable[] = [];
  // Builds a collapsible into `parent`, one of the kit's expanders.
  const addCollapsible = (
    parent: HTMLElement,
    options: CollapsibleCardOptions,
  ): CollapsibleCard => {
    const built = createCollapsibleCard(options);
    expanders.push(built);
    parent.append(built.element);
    return built;
  };
  const kit: ChatKit = {
    ...surfaceBaseKit(deps, 'chat', {
      recordAnchor: (anchor) => anchors.push(anchor),
    }),
    json: (parent, value) =>
      appended(
        parent,
        element('pre', 'chat-json', String(JSON.stringify(value, null, 2))),
      ),
    expander(parent, summary, body) {
      return kit.collapsibleCard(parent, { summary, body }).element;
    },
    collapsibleCard: (parent, options) => addCollapsible(parent, options),
    collapsibleRow: (parent, options) =>
      addCollapsible(parent, { ...options, plain: true }),
    edgeCard: (parent, edge) => appended(parent, card(edge)),
    permissionActions(parent) {
      if (current.kind !== 'permission') {
        throw new Error('permissionActions is only for a permission entry');
      }
      const part = createPermissionPart(current, deps);
      permissionParts.push(part);
      return appended(parent, part.element);
    },
    images(parent) {
      if (current.kind !== 'user') {
        throw new Error('images is only for a user entry');
      }
      return appended(parent, imageThumbnails(current.images, deps));
    },
    tokens: (count) => formatTokens(count),
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
      disposeAnchors(anchors);
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
      inside: (container) =>
        expanders.filter((expander) => container.contains(expander.element)),
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
// tab's scope; a click on Allow once only allows, though its key also copies
// with no permission pending. Once the entry carries its answer, the answer
// text, the two anchors disposed.
function createPermissionPart(
  entry: PermissionEntry,
  deps: KitDeps,
): PermissionPart {
  const part = element('div', 'chat-permission-actions');
  let current = entry;
  const anchors: Disposable[] = [];
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
  const draw = (next: PermissionEntry) => {
    current = next;
    if (next.answer !== null) {
      disposeAnchors(anchors);
      part.replaceChildren(
        element('span', 'chat-permission-answer', answerText(next.answer)),
      );
    }
  };
  if (entry.answer === null) {
    part.append(
      actionButton('Allow once', 'primary', 'allowOrCopy', (answered) =>
        deps.allow(answered),
      ),
      actionButton('Deny', 'secondary', 'denyPermission', (answered) =>
        deps.deny(answered),
      ),
    );
  }
  draw(entry);
  return { element: part, draw, dispose: () => disposeAnchors(anchors) };
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
