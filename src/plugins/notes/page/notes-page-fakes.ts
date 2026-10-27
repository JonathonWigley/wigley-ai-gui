import type { ShownLayouts } from '../../../contracts/plugin';
import { FakeElement, installFakeDom } from '../../../shared/page/test-dom';
import defaultLayout from '../layouts/default/layout.js';
import type { Layout } from '../layouts/layout';
import type { NotesPartsDeps } from './layout/notes-parts';

// The name of the user's layout the fakes show.
export const USER_LAYOUT = 'mine';

// The fake DOM of `test-dom` with `prepend`, which the colour buttons use.
export class NotesFakeElement extends FakeElement {
  prepend(...nodes: FakeElement[]) {
    const rest = [...this.childNodes];
    this.replaceChildren(...nodes, ...rest);
  }
}

// Stubs the DOM globals through `stubGlobal`, as `vi.stubGlobal`, with
// elements that are `NotesFakeElement`s.
export function installNotesFakeDom(
  stubGlobal: (name: string, value: unknown) => void,
): void {
  installFakeDom(stubGlobal);
  stubGlobal('HTMLElement', NotesFakeElement);
  stubGlobal('document', {
    createElement: (tag: string) => new NotesFakeElement(tag),
  });
}

export interface MadeAnchor {
  command: string;
  scope: string | undefined;
  isDisposed: boolean;
}

// Parts deps whose keys record every anchor they make, and which record each
// log line and each command run.
export function notesPartsDeps() {
  const anchors: MadeAnchor[] = [];
  const logged: string[] = [];
  const ran: string[] = [];
  const deps: NotesPartsDeps = {
    markdown: {
      block: () => '',
      inline: () => '',
      document: () => Promise.resolve(''),
    },
    keys: {
      anchor(_element, command, options) {
        const made = { command, scope: options?.scope, isDisposed: false };
        anchors.push(made);
        return {
          dispose() {
            made.isDisposed = true;
          },
        };
      },
      keysFor: () => null,
    },
    commands: { exists: () => true, run: (id) => ran.push(id) },
    platform: 'macos',
    log: (source, line) => logged.push(`[${source}] ${line}`),
  };
  return { deps, anchors, logged, ran };
}

// `default` and the user's `layout`, the user's picked.
export function withUser(layout: Layout): ShownLayouts<Layout> {
  return {
    layouts: new Map<string, Layout>([
      ['default', defaultLayout],
      [USER_LAYOUT, layout],
    ]),
    user: USER_LAYOUT,
  };
}
