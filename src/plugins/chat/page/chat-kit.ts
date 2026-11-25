import type { ChatEntry, ChatImage } from '../../../contracts/agent';
import type { Disposable } from '../../../contracts/disposable';
import type { PluginLog } from '../../../contracts/log';
import { callEach } from '../../../shared/call-each';
import { errorText } from '../../../shared/error-text';
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
import type { ChatEntryPart } from '../contract';
import { type ChatCommandName, chatCommand, chatScope } from '../ids';
import type { AnyEntryKind, ChatKit, EntryInput } from '../layouts/layout';
import { imageUrl } from './attachments';
import { type SurfaceKitDeps, surfaceBaseKit } from './chat-layouts';
import type { PermissionEntry } from './chat-state';

// What a click on Allow once, Deny, a thumbnail or an expander's head calls:
// `allow` and `deny` with the permission entry, `openImages` with the user
// entry's id and the thumbnail's index, `expanderClicked` with the entry's id
// and the expander's creation-order place. `keys` also anchors the permission
// actions' key hints. `entryParts` reads the parts other plugins added, each
// built for session `sessionId`; `log` takes a part's failure.
export interface KitDeps extends SurfaceKitDeps {
  sessionId: string;
  entryParts(): readonly ChatEntryPart[];
  log: PluginLog;
  allow(entry: PermissionEntry): void;
  deny(entry: PermissionEntry): void;
  openImages(entryId: string, index: number): void;
  expanderClicked(entryId: string, place: number): void;
}

// One of a kit's expanders: a collapsible card or row, or an expander.
export type Expander = Pick<CollapsibleCard, 'element' | 'isOpen' | 'setOpen'>;

export type ToggleResult = 'expanded' | 'collapsed' | 'nothing';

// The expanders one kit made (its expanders, collapsible cards and rows), in
// creation order.
export interface Expanders {
  count(): number;
  isAnyClosed(): boolean;
  setAllOpen(open: boolean): void;
  // Opens the expander at creation-order `place` when closed, else closes it;
  // `nothing` when no expander holds that place.
  toggle(place: number): ToggleResult;
  openStates(): boolean[];
  // Opens each expander whose creation-order place is open in `states`.
  restore(states: readonly boolean[]): void;
  // The expanders whose element `container` contains, in creation order.
  inside(container: HTMLElement): Expander[];
}

// One built entry's kit: the parts the layout drew from it, kept up to date by
// `update` with each later version of the entry. `updateParts` runs each
// placed entry part's `update` with the entry's later input, in place order;
// only a part's first update failure is logged. `dispose` runs each placed
// entry part's `dispose`, a throw logged and the rest still run, and disposes
// the key anchors the base kit's parts named and those a waiting permission
// entry's actions still hold; its owner calls it when it drops the kit.
export interface EntryKit {
  kit: ChatKit;
  update(entry: ChatEntry): void;
  updateParts(input: EntryInput<AnyEntryKind>): void;
  expanders: Expanders;
  dispose(): void;
}

// The base kit, its key hints anchored in the Chat tab's scope, under chat's
// own parts; `input` is the entry's input as its builder gets it.
export function createEntryKit(
  entry: ChatEntry,
  input: EntryInput<AnyEntryKind>,
  deps: KitDeps,
): EntryKit {
  let current = entry;
  // Null until the layout places the entry parts.
  let placedParts: PlacedPart[] | null = null;
  const expanders: Expander[] = [];
  const permissionParts: PermissionPart[] = [];
  const anchors: Disposable[] = [];
  // Builds a collapsible into `parent`, one of the kit's expanders; its head's
  // click goes to `expanderClicked` with its place.
  const addCollapsible = (
    parent: HTMLElement,
    options: CollapsibleCardOptions,
  ): CollapsibleCard => {
    const place = expanders.length;
    const built = createCollapsibleCard({
      ...options,
      onToggle: () => deps.expanderClicked(current.id, place),
    });
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
    entryParts(parent) {
      if (placedParts !== null) {
        throw new Error(`${entry.kind} entry placed entry parts twice`);
      }
      placedParts = placeEntryParts(parent, input, deps);
    },
    images(parent) {
      if (current.kind !== 'user') {
        throw new Error('images is only for a user entry');
      }
      return appended(
        parent,
        imageThumbnails(current.id, current.images, deps),
      );
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
    updateParts(next) {
      for (const part of placedParts ?? []) {
        updateEntryPart(part, next, deps.log);
      }
    },
    dispose() {
      callEach<() => void>(
        [
          ...(placedParts ?? []).map(
            (part) => () => disposeEntryPart(part, deps.log),
          ),
          () => disposeAnchors(anchors),
          ...[...permissionParts].map((part) => () => part.dispose()),
        ],
        (step) => step(),
      );
    },
    expanders: {
      count: () => expanders.length,
      isAnyClosed: () => expanders.some((expander) => !expander.isOpen()),
      setAllOpen(open) {
        for (const expander of expanders) {
          expander.setOpen(open);
        }
      },
      toggle(place) {
        const expander = expanders.at(place);
        if (expander === undefined || place < 0) {
          return 'nothing';
        }
        const opens = !expander.isOpen();
        expander.setOpen(opens);
        return opens ? 'expanded' : 'collapsed';
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

// An entry part built in the entry, with the update and dispose it returned.
interface PlacedPart {
  id: string;
  update: ((input: EntryInput<AnyEntryKind>) => void) | undefined;
  dispose: (() => void) | undefined;
  isUpdateFailureLogged: boolean;
}

// `div.chat-entry-parts` at the end of `parent`, holding one
// `div.chat-entry-part` (`data-part="<id>"`) per part of the entry's kind, in
// add order, each built for `input` and the session; nothing when no part is
// of the kind. A part that throws is logged and its wrapper removed; the rest
// still draw.
function placeEntryParts(
  parent: HTMLElement,
  input: EntryInput<AnyEntryKind>,
  deps: Pick<KitDeps, 'sessionId' | 'entryParts' | 'log'>,
): PlacedPart[] {
  const placed: PlacedPart[] = [];
  const parts = deps
    .entryParts()
    .filter((part) => part.kinds.includes(input.kind));
  if (parts.length === 0) {
    return placed;
  }
  const holder = appended(parent, element('div', 'chat-entry-parts'));
  for (const part of parts) {
    const wrapper = appended(holder, element('div', 'chat-entry-part'));
    wrapper.dataset.part = part.id;
    try {
      const built = part.build(wrapper, { sessionId: deps.sessionId, input });
      placed.push({
        id: part.id,
        update: built.update?.bind(built),
        dispose: built.dispose?.bind(built),
        isUpdateFailureLogged: false,
      });
    } catch (error) {
      wrapper.remove();
      deps.log(`entry part ${part.id} failed: ${errorText(error)}`);
    }
  }
  return placed;
}

// Runs the part's update with `input`; only its first throw is logged.
function updateEntryPart(
  part: PlacedPart,
  input: EntryInput<AnyEntryKind>,
  log: PluginLog,
) {
  try {
    part.update?.(input);
  } catch (error) {
    if (!part.isUpdateFailureLogged) {
      part.isUpdateFailureLogged = true;
      log(`entry part ${part.id} update failed: ${errorText(error)}`);
    }
  }
}

// Runs the part's dispose; a throw is logged.
function disposeEntryPart(part: PlacedPart, log: PluginLog) {
  try {
    part.dispose?.();
  } catch (error) {
    log(`entry part ${part.id} dispose failed: ${errorText(error)}`);
  }
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

// One thumbnail per image of entry `entryId`, a click on each calling
// `openImages` with its own index.
function imageThumbnails(
  entryId: string,
  images: readonly ChatImage[],
  deps: Pick<KitDeps, 'openImages'>,
): HTMLElement {
  const strip = element('div', 'chat-images');
  strip.append(
    ...images.map((image, index) => {
      const thumbnail = element('img', 'chat-image-thumbnail');
      thumbnail.src = imageUrl(image);
      thumbnail.alt = `Image ${index + 1} of ${images.length}`;
      thumbnail.addEventListener('click', () =>
        deps.openImages(entryId, index),
      );
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
