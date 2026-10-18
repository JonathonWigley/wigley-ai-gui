// Composition root for the renderer: the one module that picks adapters and
// wires features to them.
import './index.css';
import type { EditorEvents } from '../contracts/editor';
import { CommandRegistry } from '../shared/command-registry';
import { registerBoxCommands } from './boxes';
import { createCodeMirrorVimHost } from './codemirror-vim/codemirror-vim-host';
import { createLogView } from './log-view';
import { installPageKeys } from './page-keys';
import type {
  RendererCommandContext,
  RendererCommands,
} from './renderer-commands';

const ignoreEvents: EditorEvents = {
  changed: () => {},
  focused: () => {},
  blurred: () => {},
  modeChanged: () => {},
};

async function start() {
  const bridge = window.wigley;
  const log = createLogView(document.getElementById('log') as HTMLOListElement);
  bridge.onLog(log);
  const { keymap, settings } = await bridge.config();

  const commands: RendererCommands =
    new CommandRegistry<RendererCommandContext>();
  const editors = createCodeMirrorVimHost(keymap.editor, (command, editor) =>
    commands.run(command, { editor }),
  );
  const boxes = [...document.querySelectorAll<HTMLElement>('.box')].map(
    (parent, index) => editors.create(parent, `box ${index + 1}`, ignoreEvents),
  );

  registerBoxCommands(commands, boxes, log);
  commands.requireRegistered(
    [...keymap.editor.binds, ...keymap.page].map((bind) => bind.command),
  );
  installPageKeys(
    keymap.page,
    settings.keySequenceTimeoutMs,
    () => 'forms',
    editors,
    commands,
    log,
  );
  boxes[0].focus();
}

void start();
