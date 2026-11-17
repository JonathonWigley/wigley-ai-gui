import type { Disposable } from '../../../contracts/disposable';
import type { PluginLog } from '../../../contracts/log';
import { errorText } from '../../../shared/error-text';
import type { PartPick } from '../../../shared/page/layout-host/draw-part';
import type { ChatEntryRenderer } from '../contract';
import type {
  AnyEntryKind,
  ChatLayout,
  EntryInput,
} from '../layouts/layout';

// The name a renderer's draw goes by: its root's `data-layout`, and its
// failure's log line (`layout entry renderer <kind> entry failed: …`).
export const ENTRY_RENDERER_NAME = 'entry renderer';

// The entry renderers plugins added. `pick` walks them latest first and
// returns the first whose `kind` equals the input's and whose `match`, when
// given, returns true, as a one-kind layout named `entry renderer`; null when
// none does. A `match` that throws is logged and counts as false. `onChanged`
// hears each add and each first `dispose` of one.
export interface EntryRenderers {
  add<K extends AnyEntryKind>(renderer: ChatEntryRenderer<K>): Disposable;
  pick(input: EntryInput<AnyEntryKind>): PartPick<ChatLayout> | null;
  onChanged(listener: () => void): Disposable;
}

// One added renderer and the layout it draws through, made once at `add` so
// the page host logs a failure once per renderer.
interface HeldRenderer {
  renderer: ChatEntryRenderer;
  layout: ChatLayout;
}

export function createEntryRenderers(log: PluginLog): EntryRenderers {
  // Latest first. Each add is its own holder, so one renderer added twice is
  // two renderers.
  let held: readonly HeldRenderer[] = [];
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) {
      listener();
    }
  };
  return {
    add(added) {
      // TypeScript cannot tie a renderer's kind to its builder's input.
      const renderer = added as unknown as ChatEntryRenderer;
      const holder: HeldRenderer = {
        renderer,
        layout: {
          entries: { [renderer.kind]: renderer.build },
        } as ChatLayout,
      };
      held = [holder, ...held];
      changed();
      return {
        dispose() {
          if (!held.includes(holder)) {
            return;
          }
          held = held.filter((other) => other !== holder);
          changed();
        },
      };
    },
    pick(input) {
      const picked = held.find(({ renderer }) =>
        drawsInput(renderer, input, log),
      );
      return picked === undefined
        ? null
        : { name: ENTRY_RENDERER_NAME, layout: picked.layout };
    },
    onChanged(listener) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  };
}

// Whether `renderer` draws `input`: its kind, and its `match` when given.
function drawsInput(
  renderer: ChatEntryRenderer,
  input: EntryInput<AnyEntryKind>,
  log: PluginLog,
): boolean {
  if (renderer.kind !== input.kind) {
    return false;
  }
  if (renderer.match === undefined) {
    return true;
  }
  try {
    return renderer.match(input);
  } catch (error) {
    log(`entry renderer ${renderer.kind} match failed: ${errorText(error)}`);
    return false;
  }
}
