import type { EditorHost } from '../contracts/editor';
import type { PageBind } from '../contracts/keymap';
import type { Log } from '../contracts/log';
import type { RendererCommands } from './renderer-commands';

// Keys for when no editor has focus.
export function installPageKeys(
  binds: PageBind[],
  editors: EditorHost,
  commands: RendererCommands,
  log: Log,
) {
  document.addEventListener('keydown', (event) => {
    const bind = binds.find((candidate) => candidate.key === event.key);
    if (!bind || editors.contains(event.target as Element)) {
      return;
    }
    event.preventDefault();
    log('page', `${bind.key} ran ${bind.command}`);
    commands.run(bind.command, {});
  });
}
