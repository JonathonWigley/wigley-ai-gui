import type { CommandId } from '../../../contracts/commands';
import type { PluginLog } from '../../../contracts/log';
import type { MarkdownRenderer } from '../../../contracts/markdown';
import type { OsName } from '../../../contracts/platform';
import type {
  CommandInfo,
  DrawnLayoutPart,
  KeyHints,
  LayoutPartBuilt,
  LayoutShow,
  PageLayoutShow,
  PluginCommands,
  PluginManifest,
  ShowLayoutOptions,
  ShownLayouts,
} from '../../../contracts/plugin';
import type { LayoutState } from '../../../contracts/state';
import { callEach } from '../../call-each';
import { requireDeclaredScope } from '../../plugin-manifests';
import {
  createBaseKit,
  kitCommandsOf,
  type OwnerKitServices,
  ownerBaseKitDeps,
} from './base-kit';
import type { BaseKit } from './kit';
import { createLayoutParts } from './layout-parts';

export interface OwnerShowDeps<L> {
  manifest: Pick<PluginManifest, 'id' | 'commands' | 'scopes'>;
  kit: OwnerKitServices; // the plugin's own services, as a built-in's start builds them
  log: PluginLog; // the plugin's log
  options: ShowLayoutOptions<L>;
  // Starts the show over the options the owner show hands it.
  show(options: ShowLayoutOptions<L>): LayoutShow;
}

// A layout part as `draw` calls it.
type PartBuilder = (
  parent: HTMLElement,
  input: unknown,
  kit: BaseKit,
) => { element: HTMLElement };

// A show of `options` that also draws parts with the owner's base kit. The
// inner show's `setLayouts` hands each set to the draws first and then to
// `options.setLayouts`, so a `draw` inside the owner's `setLayouts` draws with
// that set. Each draw builds a fresh kit for each drawing attempt, so
// `drawPart`'s rollback and fallback cover what the kit records. The show
// keeps each draw until its `dispose`; the show's `dispose` disposes the kept
// draws, then the inner show.
export function ownerLayoutShow<L>(deps: OwnerShowDeps<L>): PageLayoutShow<L> {
  // `createLayoutParts` and `drawPart` take `L extends object`, and a show's
  // `L` stays unconstrained, as `PageApi.layouts.show<L>` has it; every layout
  // a reader returns is an object, so `L` is narrowed once here.
  type Layout = L & object;
  const { manifest, options } = deps;
  const parts = createLayoutParts<Layout, Layout>({
    owner: manifest.id,
    defaultLayout: options.defaultLayout as Layout,
    log: deps.log,
  });
  const kept = new Set<DrawnLayoutPart<unknown>>();
  const inner = deps.show({
    ...options,
    setLayouts(shown) {
      parts.setLayouts(shown as ShownLayouts<Layout>);
      options.setLayouts(shown);
    },
  });
  return {
    refresh: () => inner.refresh(),
    draw(part, parent, input, drawOptions = {}) {
      const scope = drawOptions.scope ?? null;
      if (scope !== null) {
        requireDeclaredScope(manifest, scope);
      }
      const drawn = parts.draw(
        part as keyof Layout & string,
        parent,
        (builder, slot, rollback) =>
          (builder as unknown as PartBuilder)(
            slot,
            input,
            createBaseKit(
              ownerBaseKitDeps(manifest, deps.kit, scope, rollback),
            ),
          ),
      );
      let isDisposed = false;
      const draw: DrawnLayoutPart<LayoutPartBuilt<L, typeof part>> = {
        built: drawn.built as LayoutPartBuilt<L, typeof part>,
        layoutName: drawn.layoutName,
        dispose() {
          if (isDisposed) {
            return;
          }
          isDisposed = true;
          kept.delete(draw);
          drawn.dispose();
        },
      };
      kept.add(draw);
      return draw;
    },
    dispose() {
      const draws = [...kept];
      kept.clear();
      try {
        callEach(draws, (draw) => draw.dispose());
      } finally {
        inner.dispose();
      }
    },
  };
}

// What `ownerKitServicesOf` reads from a plugin's page API.
export interface OwnerKitApi {
  keys: Pick<KeyHints, 'anchor' | 'keysFor'> & {
    command(id: CommandId): CommandInfo | undefined;
  };
  commands: Pick<PluginCommands, 'run'>;
  services: { markdown: MarkdownRenderer; log: PluginLog };
  platform: { os: OsName };
  state: { forLayouts: LayoutState };
}

// The base-kit services of a plugin, made from its own page API members as a
// built-in's start makes them: its markdown, key hints, commands, platform,
// layout state and log.
export function ownerKitServicesOf(api: OwnerKitApi): OwnerKitServices {
  return {
    markdown: api.services.markdown,
    keys: api.keys,
    commands: kitCommandsOf(api),
    platform: api.platform.os,
    state: api.state.forLayouts,
    log: api.services.log,
  };
}
