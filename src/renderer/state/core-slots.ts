import {
  coreModeSlot,
  coreScopeSlot,
  coreThemeSlot,
} from '../../contracts/core-state';
import type { Modes } from '../../contracts/plugin';
import type { SlotStore } from '../../shared/state/slot-store';
import type { ScopeStack } from '../key-scope';

// Writes the page's core slots over the last page's values before it returns, then
// keeps the scope and mode slots current. The writers live as long as `store`.
// `themeApplied` writes the theme slot only for a new name.
export function startPageCoreSlots(
  store: SlotStore,
  deps: {
    scope: Pick<ScopeStack, 'current' | 'onChange'>;
    modes: Pick<Modes, 'onChanged'>;
    theme: string;
  },
): { themeApplied(name: string): void } {
  const mode = store.publish(coreModeSlot);
  const scope = store.publish(coreScopeSlot);
  const theme = store.publish(coreThemeSlot);
  mode.set('');
  scope.set(deps.scope.current());
  theme.set(deps.theme);
  deps.scope.onChange((next) => scope.set(next));
  deps.modes.onChanged((modeId) => mode.set(modeId));
  return {
    themeApplied(name) {
      if (name !== theme.get()) {
        theme.set(name);
      }
    },
  };
}
