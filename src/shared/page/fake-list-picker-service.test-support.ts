import type { EditorHost } from '../../contracts/editor';
import type {
  ListPickerOptions,
  ListPickerService,
} from '../../contracts/list-picker';
import type { PluginLog } from '../../contracts/log';
import type { PushedScope } from '../../contracts/plugin';
import { fakeFuzzyMatcher } from '../fake-fuzzy-matcher.test-support';
import { createListPicker } from './list-picker';

interface FakeListPickerOptions {
  // Takes the element of a list with no `parent`, as the window's overlay does.
  place?(element: HTMLElement): void;
  // The editor a list with `filter` builds its box on; without one, no box.
  editor?: EditorHost;
  log?: PluginLog;
  // Pushes the named scope; a scope that does nothing when left out.
  pushScope?(scope: string): PushedScope;
}

// A real createListPicker over a fake matcher. `scopes` records each scope
// pushed, by its short name, and `created` each `create`'s options.
export function fakeListPickerService(
  fakes: FakeListPickerOptions = {},
): ListPickerService & { scopes: string[]; created: ListPickerOptions[] } {
  const scopes: string[] = [];
  const created: ListPickerOptions[] = [];
  return {
    scopes,
    created,
    create(options = {}) {
      created.push(options);
      const { scope = 'picker', filter = false, parent } = options;
      const picker = createListPicker({
        pushScope() {
          const name = typeof scope === 'string' ? scope : scope();
          scopes.push(name);
          return (
            fakes.pushScope?.(name) ?? {
              pop: () => undefined,
              dispose: () => undefined,
              onBaseChanged: () => ({ dispose: () => undefined }),
            }
          );
        },
        log: fakes.log ?? (() => undefined),
        matcher: fakeFuzzyMatcher,
        filterEditor: filter ? fakes.editor : undefined,
      });
      if (parent === undefined) {
        fakes.place?.(picker.element);
      } else {
        parent.append(picker.element);
      }
      return picker;
    },
  };
}
