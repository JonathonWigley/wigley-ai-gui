import { CORE_OPEN_LINK } from '../contracts/commands';
import type { PageCommandContext, PageServices } from '../contracts/plugin';
import type { CommandRegistry } from '../shared/command-registry';
import { errorText } from '../shared/error-text';

const RENDERED_LINK = 'a.md-link[data-href]';

export interface LinkCommandDeps {
  openExternal: PageServices['openExternal'];
  toast: PageServices['toast'];
  log(message: string): void;
}

// Registers `core.openLink` under `core`: it logs `opened link <url>` once the
// URL opens, and toasts the error when main refuses it.
export function registerLinkCommands(
  commands: Pick<CommandRegistry<PageCommandContext<any>>, 'register'>,
  deps: LinkCommandDeps,
): void {
  commands.register(
    CORE_OPEN_LINK.id,
    async ({ arg }: PageCommandContext<string>) => {
      try {
        await deps.openExternal(arg);
        deps.log(`opened link ${arg}`);
      } catch (error) {
        deps.toast(errorText(error), 'error');
      }
    },
    'core',
  );
}

// Runs `open` with the `data-href` of each rendered link a primary click lands
// on, unless a view's own listener already took the click (docs' links).
export function listenToLinkClicks(
  root: Pick<Document, 'addEventListener'>,
  open: (url: string) => void,
): void {
  root.addEventListener('click', (event) => {
    const isPrimaryClick = event.button === 0;
    if (event.defaultPrevented || !isPrimaryClick) {
      return;
    }
    // A click's target is always an element: one on text targets its parent.
    const target = event.target as Element | null;
    const link = target?.closest<HTMLElement>(RENDERED_LINK) ?? null;
    if (link === null) {
      return;
    }
    event.preventDefault();
    open(link.dataset.href ?? '');
  });
}
