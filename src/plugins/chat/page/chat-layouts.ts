import type { ChatEntryKind } from '../../../contracts/agent';
import type { Disposable } from '../../../contracts/disposable';
import type { PluginLog } from '../../../contracts/log';
import type { KeyHints, ShownLayouts } from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import {
  createBaseKit,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from '../../../shared/page/layout-host/base-kit';
import type {
  DrawnPart,
  PartPick,
  RollbackDeps,
} from '../../../shared/page/layout-host/draw-part';
import type { BaseKit } from '../../../shared/page/layout-host/kit';
import {
  type BuildPart,
  createLayoutParts,
  type LayoutParts,
} from '../../../shared/page/layout-host/layout-parts';
import { pickLayout } from '../../../shared/page/layout-host/pick';
import type { ChatScopeName } from '../ids';
import defaultLayout from '../layouts/default/layout.js';
import type {
  AnyEntryKind,
  ChatLayout,
  CompleteChatLayout,
  EntryInput,
  HarnessEntryKind,
  PartView,
} from '../layouts/layout';
import { chatManifest } from '../manifest';
import type { EntryRenderers } from './entry-renderers';

// The chat layout's parts beside the entries.
export type ChatPartName = Exclude<
  keyof ChatLayout,
  'entries' | 'activityInTranscript'
>;

// The chat layouts every surface draws with: `set` replaces them and tells
// each `onChange` listener. `draw` draws a part with the user's layout when
// it defines the part, else with `default`; `drawDefault` draws it with
// `default` alone.
export interface ChatLayouts {
  shown(): ShownLayouts<ChatLayout>;
  set(shown: ShownLayouts<ChatLayout>): void;
  onChange(listener: () => void): Disposable;
  draw: ChatParts['draw'];
  drawDefault: ChatParts['draw'];
}

type ChatParts = LayoutParts<ChatLayout, CompleteChatLayout>;

export function createChatLayouts(log: PluginLog): ChatLayouts {
  const deps = { owner: 'chat', defaultLayout, log } as const;
  const parts = createLayoutParts<ChatLayout, CompleteChatLayout>(deps);
  const defaultParts = createLayoutParts<ChatLayout, CompleteChatLayout>(deps);
  const listeners = new Set<() => void>();
  return {
    shown: () => parts.shown(),
    set(next) {
      parts.setLayouts(next);
      for (const listener of listeners) {
        listener();
      }
    },
    onChange(listener) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    draw: (key, parent, build) => parts.draw(key, parent, build),
    drawDefault: (key, parent, build) => defaultParts.draw(key, parent, build),
  };
}

export const DEFAULT_ENTRY_PICK: PartPick<ChatLayout> = {
  name: 'default',
  layout: defaultLayout,
};

// The layout `kind`'s entries draw with: the user's when it defines the kind,
// else `default`.
export function pickEntry(
  shown: ShownLayouts<ChatLayout>,
  kind: ChatEntryKind,
): PartPick<ChatLayout> {
  return pickLayout(
    [shown.user, DEFAULT_ENTRY_PICK.name],
    shown.layouts,
    (layout) => layout.entries?.[kind] !== undefined,
  );
}

// What draws an entry, and the builder it reads: the user's layout when it
// names the entry's kind; else the latest-added renderer that draws the
// entry; else `default`, whose `raw` builder draws a harness kind.
export interface EntryDrawPick {
  pick: PartPick<ChatLayout>;
  builderKind: AnyEntryKind;
}

export function pickEntryDraw(
  shown: ShownLayouts<ChatLayout>,
  renderers: Pick<EntryRenderers, 'pick'>,
  input: EntryInput<AnyEntryKind>,
): EntryDrawPick {
  const named = pickEntry(shown, input.kind);
  if (named.name !== DEFAULT_ENTRY_PICK.name) {
    return { pick: named, builderKind: input.kind };
  }
  const rendered = renderers.pick(input);
  if (rendered !== null) {
    return { pick: rendered, builderKind: input.kind };
  }
  return { pick: named, builderKind: defaultBuilderKind(input.kind) };
}

// The kind whose builder `default` draws an entry of `kind` with: `raw` for a
// harness kind, else the kind itself.
export function defaultBuilderKind(kind: AnyEntryKind): AnyEntryKind {
  return isHarnessKind(kind) ? 'raw' : kind;
}

export function isHarnessKind(kind: string): kind is HarnessEntryKind {
  return kind.includes(':');
}

// Whether the entry list draws runs and result entries: the user's layout's
// flag when it sets one, else default's.
export function isActivityInTranscript(
  shown: ShownLayouts<ChatLayout>,
): boolean {
  const { layout } = pickLayout(
    [shown.user, DEFAULT_ENTRY_PICK.name],
    shown.layouts,
    (candidate) => candidate.activityInTranscript !== undefined,
  );
  return layout.activityInTranscript === true;
}

// What running a drawn view's update came to: it ran, the view has none, or
// it threw.
export type UpdateResult = 'ran' | 'none' | 'threw';

// One part's draws. Once a drawn view's update throws, the part draws with
// `default` alone until the layouts change.
export interface ChatPartDraws<K extends ChatPartName> {
  draw<R extends { element: HTMLElement }>(
    parent: HTMLElement,
    build: BuildPart<CompleteChatLayout[K], R>,
  ): DrawnPart<R>;
  // Runs the drawn view's update with `input`. A throw is logged as
  // `layout <name> <part> update failed: <error>`.
  update<I>(drawn: DrawnPart<{ view: PartView<I> }>, input: I): UpdateResult;
}

export function chatPartDraws<K extends ChatPartName>(
  layouts: ChatLayouts,
  key: K,
  log: PluginLog,
): ChatPartDraws<K> {
  // The layouts shown when an update threw; the part draws with `default`
  // while they are still the shown ones.
  let failedUnder: ShownLayouts<ChatLayout> | null = null;
  return {
    draw(parent, build) {
      return failedUnder === layouts.shown()
        ? layouts.drawDefault(key, parent, build)
        : layouts.draw(key, parent, build);
    },
    update(drawn, input) {
      const { update } = drawn.built.view;
      if (update === undefined) {
        return 'none';
      }
      try {
        update.call(drawn.built.view, input);
        return 'ran';
      } catch (error) {
        log(
          `layout ${drawn.layoutName} ${key} update failed: ${errorText(error)}`,
        );
        failedUnder = layouts.shown();
        return 'threw';
      }
    },
  };
}

// What every surface's kit reads beside its own parts; `keys` also anchors
// the app's own key hints.
export interface SurfaceKitDeps extends OwnerKitServices {
  keys: Pick<KeyHints, 'anchor' | 'keysFor'>;
}

// The base kit for a part drawing in chat's `scope`, each key anchor its
// parts name handed to `rollback`.
export function surfaceBaseKit(
  deps: SurfaceKitDeps,
  scope: ChatScopeName,
  rollback: Pick<RollbackDeps, 'recordAnchor'>,
): BaseKit {
  return createBaseKit(ownerBaseKitDeps(chatManifest, deps, scope, rollback));
}
