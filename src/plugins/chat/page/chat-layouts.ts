import type { Disposable } from '../../../contracts/disposable';
import type { Log } from '../../../contracts/log';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type { Platform } from '../../../contracts/platform';
import type { ShownLayouts } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import {
  createBaseKit,
  type KitCommands,
} from '../../../shared/page/layout-host/base-kit';
import {
  type DrawnPart,
  drawPart,
  type RollbackDeps,
} from '../../../shared/page/layout-host/draw-part';
import type { BaseKit } from '../../../shared/page/layout-host/kit';
import { pickLayout } from '../../../shared/page/layout-host/pick';
import type { KeysPageExports } from '../../keys/contract';
import { type ChatScopeName, chatCommandNamed, chatScope } from '../ids';
import defaultLayout from '../layouts/default/layout.js';
import type { ChatLayout, PartView } from '../layouts/layout';

// The chat layout's parts beside the entries.
export type ChatPartName =
  | 'composer'
  | 'composerBar'
  | 'attachments'
  | 'pickerRow'
  | 'signIn'
  | 'reasonBox'
  | 'closeConfirm'
  | 'imageViewer';

// The chat layouts every surface draws with: `set` replaces them and tells
// each `onChange` listener.
export interface ChatLayouts {
  current(): ShownLayouts<ChatLayout>;
  set(shown: ShownLayouts<ChatLayout>): void;
  onChange(listener: () => void): Disposable;
}

export function createChatLayouts(): ChatLayouts {
  let shown: ShownLayouts<ChatLayout> = {
    layouts: new Map([['default', defaultLayout]]),
    user: 'default',
  };
  const listeners = new Set<() => void>();
  return {
    current: () => shown,
    set(next) {
      shown = next;
      for (const listener of listeners) {
        listener();
      }
    },
    onChange(listener) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  };
}

export interface DrawChatPartOptions<B, R extends { element: HTMLElement }> {
  layouts: ChatLayouts;
  parent: HTMLElement;
  partName: ChatPartName;
  part(layout: ChatLayout): B | undefined;
  build(builder: B, parent: HTMLElement, rollback: RollbackDeps): R;
  log: Log;
}

// Draws the part with the user's layout when it defines the part, else with
// `default`, through the page host: a user part that throws is rolled back,
// logged and drawn with `default`.
export function drawChatPart<B, R extends { element: HTMLElement }>(
  options: DrawChatPartOptions<B, R>,
): DrawnPart<R> {
  const shown = options.layouts.current();
  const pick = pickLayout(
    [shown.user, 'default'],
    shown.layouts,
    (layout) => options.part(layout) !== undefined,
  );
  return drawPart<ChatLayout, B, R>({
    owner: 'chat',
    parent: options.parent,
    pick,
    defaultLayout,
    part: options.part,
    build: options.build,
    log: options.log,
    logSource: 'chat',
    partName: options.partName,
  });
}

// Runs the drawn view's update with `input`; true when it ran. An update that
// throws is logged as `layout <name> <part> update failed: <error>` and
// counts as not run, so the caller may draw the part again.
export function updateView<I>(
  drawn: DrawnPart<{ view: PartView<I> }>,
  input: I,
  partName: ChatPartName,
  log: Log,
): boolean {
  const { update } = drawn.built.view;
  if (update === undefined) {
    return false;
  }
  try {
    update.call(drawn.built.view, input);
    return true;
  } catch (error) {
    log(
      'chat',
      `layout ${drawn.layoutName} ${partName} update failed: ${errorText(error)}`,
    );
    return false;
  }
}

// What every surface's kit reads beside its own parts.
export interface SurfaceKitDeps {
  markdown: MarkdownRenderer;
  keys: Pick<KeysPageExports, 'anchor' | 'keysFor'>;
  commands: KitCommands;
  platform: Platform;
}

// The base kit for a part drawing in chat's `scope`, each key anchor its
// parts name handed to `record`.
export function surfaceBaseKit(
  deps: SurfaceKitDeps,
  scope: ChatScopeName,
  record: (anchor: Disposable) => void,
): BaseKit {
  return createBaseKit({
    markdown: deps.markdown,
    keys: {
      keysFor: deps.keys.keysFor,
      anchor(node, command, options) {
        const anchor = deps.keys.anchor(node, command, options);
        record(anchor);
        return anchor;
      },
    },
    commands: deps.commands,
    platform: deps.platform,
    scope: chatScope(scope),
    commandNamed: chatCommandNamed,
  });
}

// An app-owned element (a box, a slot, a row of actions) a kit part places
// into the part drawing.
export interface PartSlot {
  // Appends the element to `parent`; throws `<name> placed twice` on a second
  // call in one draw.
  place(parent: HTMLElement): HTMLElement;
  // Appends the element to `root` when no `place` call placed it.
  placeIfLeftOut(root: HTMLElement): void;
}

// The slot for `element` in one draw attempt. Placing it records, through
// `rollback`, a destroy that detaches it from the part, so a failed attempt
// or the draw's dispose leaves it free for the next draw.
export function partSlot(
  element: HTMLElement,
  name: string,
  rollback: RollbackDeps,
): PartSlot {
  let isPlaced = false;
  const slot: PartSlot = {
    place(parent) {
      if (isPlaced) {
        throw new Error(`${name} placed twice`);
      }
      isPlaced = true;
      parent.append(element);
      rollback.recordBox(() => element.remove());
      return element;
    },
    placeIfLeftOut(root) {
      if (!isPlaced) {
        slot.place(root);
      }
    },
  };
  return slot;
}

// Appends `node` to `parent` and returns it, as every kit part does.
export function placed<E extends HTMLElement>(parent: HTMLElement, node: E): E {
  parent.append(node);
  return node;
}
