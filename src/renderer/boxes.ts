import type { TextEditor } from '../contracts/editor';
import type { Log } from '../contracts/log';
import type { RendererCommands } from './renderer-commands';

// Moving focus between the page's editor boxes, and out of them.
export function registerBoxCommands(
  commands: RendererCommands,
  boxes: TextEditor[],
  log: Log,
) {
  const focusBox = (index: number) => {
    boxes[index].focus();
    log('box', `focused box ${index + 1}`);
  };
  // From the box the command fired in; a page key starts from the first box.
  const focusBy = (from: TextEditor | undefined, step: number) => {
    const index = from ? boxes.indexOf(from) : -1;
    if (index < 0) {
      focusBox(0);
      return;
    }
    focusBox((index + step + boxes.length) % boxes.length);
  };

  commands.register('box.next', ({ editor }) => focusBy(editor, +1));
  commands.register('box.prev', ({ editor }) => focusBy(editor, -1));
  commands.register('box.focusFirst', () => focusBox(0));
  commands.register('box.leave', ({ editor }) => {
    editor?.blur();
    log('box', 'left the box for the page');
  });
}
