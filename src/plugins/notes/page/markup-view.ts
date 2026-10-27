import type { CommandId } from '../../../contracts/commands';
import type { Log } from '../../../contracts/log';
import type {
  MarkupEditor,
  MarkupSession,
  MarkupTool,
} from '../../../contracts/markup';
import type { Platform } from '../../../contracts/platform';
import type {
  PageChannel,
  PushedScope,
  ToastTone,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { element } from '../../../shared/page/dom';
import { keyHint } from '../../../shared/page/key-hint';
import { textButton } from '../../../shared/page/ui/button';
import type { KeysPageExports } from '../../keys/contract';
import type { NoteDraft, NotesChannel } from '../contract';

// The markup colours in the order `c` steps through them, each the theme
// token `--wg-notes-markup-<name>`.
const COLOURS = ['red', 'yellow', 'green', 'blue'] as const;

type Colour = (typeof COLOURS)[number];

const COLOUR_LABELS: Record<Colour, string> = {
  red: 'Red',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
};

const TOOLS: readonly { tool: MarkupTool; label: string; command: string }[] = [
  { tool: 'select', label: 'Select', command: 'toolSelect' },
  { tool: 'pen', label: 'Pen', command: 'toolPen' },
  { tool: 'text', label: 'Text', command: 'toolText' },
  { tool: 'arrow', label: 'Arrow', command: 'toolArrow' },
  { tool: 'box', label: 'Box', command: 'toolBox' },
];

const SCOPE = 'notes.markup';

export interface MarkupViewDeps {
  channel: PageChannel<NotesChannel>;
  markup: MarkupEditor;
  keys: Pick<KeysPageExports, 'keysFor'>;
  platform: Platform;
  run(command: CommandId): void;
  // Pushes the `markup` scope.
  pushScope(): PushedScope;
  // The PNG bytes of image `id`.
  imageBytes(id: number): Promise<Uint8Array>;
  // The view hid: the popup shows its fields again.
  closed(): void;
  // Main saved the markup and answered with the draft.
  saved(draft: NoteDraft): void;
  log: Log;
  toast(text: string, tone: ToastTone): void;
}

// One image under markup: a toolbar of the tools and colours, and the host
// the markup editor draws in. `open` pushes the `markup` scope and shows the
// image's saved markup with the pen and the first colour; `close` ends a text
// still being edited, pops the scope, tells `closed`, then saves the markup
// when it changed since `open`. The tool, colour, undo and redo calls do
// nothing until the editor has opened.
export interface MarkupView {
  element: HTMLElement;
  isShown(): boolean;
  // `pos` is the image's 1-based place in the strip, which the log names.
  open(id: number, pos: number): void;
  close(): void;
  // Resolves once every save `close` started has answered.
  savesSettled(): Promise<void>;
  setTool(tool: MarkupTool): void;
  stepColour(step: 1 | -1): void;
  undo(): void;
  redo(): void;
  // Draws the toolbar's key hints again from the keymap.
  redrawHints(): void;
}

interface Shown {
  id: number;
  pos: number;
  scope: PushedScope;
  session: MarkupSession | null;
  changed: boolean;
}

// The colour's CSS value, read from the theme now, so a theme change reaches
// the next stroke.
function readColour(colour: Colour): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(`--wg-notes-markup-${colour}`)
    .trim();
}

function group(children: readonly HTMLElement[]): HTMLElement {
  const node = element('div', 'notes-markup-group');
  node.append(...children);
  return node;
}

export function createMarkupView(deps: MarkupViewDeps): MarkupView {
  const root = element('div', 'notes-markup');
  const toolbar = element('div', 'notes-markup-toolbar');
  const host = element('div', 'notes-markup-host');
  root.append(toolbar, host);

  let shown: Shown | null = null;
  let tool: MarkupTool = 'pen';
  let colourIndex = 0;
  let saves: Promise<void> = Promise.resolve();

  const hint = (command: string) =>
    keyHint(deps.keys.keysFor(`notes.${command}`, SCOPE), deps.platform);

  const commandButton = (label: string, command: string) =>
    textButton(label, () => deps.run(`notes.${command}`), {
      variant: 'ghost',
      hint: hint(command),
    });

  const drawToolbar = () => {
    const tools = TOOLS.map((entry) => {
      const node = commandButton(entry.label, entry.command);
      node.classList.toggle('is-active', entry.tool === tool);
      return node;
    });
    const swatches = COLOURS.map((colour, index) => {
      const node = textButton(COLOUR_LABELS[colour], () => pickColour(index), {
        variant: 'ghost',
      });
      node.classList.add('notes-colour');
      node.classList.toggle('is-active', index === colourIndex);
      node.prepend(element('span', `notes-swatch notes-swatch--${colour}`));
      return node;
    });
    const colourKeys = element('span', 'notes-markup-keys');
    for (const node of [hint('nextColour'), hint('prevColour')]) {
      if (node !== null) {
        colourKeys.append(node);
      }
    }
    toolbar.replaceChildren(
      group(tools),
      group([...swatches, colourKeys]),
      group([
        commandButton('Undo', 'undo'),
        commandButton('Redo', 'redo'),
        commandButton('Done', 'closeMarkup'),
      ]),
    );
  };

  const sessionNow = (): MarkupSession | null => shown?.session ?? null;

  const pickColour = (index: number) => {
    const session = sessionNow();
    if (session === null) {
      return;
    }
    colourIndex = index;
    const colour = COLOURS[index];
    session.setColour(readColour(colour));
    drawToolbar();
    deps.log('notes', `colour ${colour}`);
  };

  // Hides the view and pops its scope; returns what it showed.
  const hide = (): Shown | null => {
    const held = shown;
    if (held === null) {
      return null;
    }
    shown = null;
    held.session?.dispose();
    host.replaceChildren();
    held.scope.pop();
    deps.closed();
    return held;
  };

  const openSession = async (entry: Shown) => {
    try {
      const [bytes, saved] = await Promise.all([
        deps.imageBytes(entry.id),
        deps.channel.invoke('markup', entry.id),
      ]);
      if (shown !== entry) {
        return;
      }
      const session = await deps.markup.open(host, bytes, saved);
      if (shown !== entry) {
        session.dispose();
        return;
      }
      entry.session = session;
      session.onChange(() => {
        entry.changed = true;
      });
      session.setTool(tool);
      session.setColour(readColour(COLOURS[colourIndex]));
      deps.log('notes', `markup shown for image ${entry.pos}`);
    } catch (error) {
      if (shown !== entry) {
        return;
      }
      const message = `Markup not opened: ${errorText(error)}`;
      deps.toast(message, 'error');
      deps.log('notes', message);
      hide();
    }
  };

  const saveMarkup = async (entry: Shown, json: string) => {
    try {
      const draft = await deps.channel.invoke('saveMarkup', entry.id, json);
      deps.saved(draft);
      deps.log('notes', `markup saved for image ${entry.pos}`);
    } catch (error) {
      const message = `Markup not saved: ${errorText(error)}`;
      deps.toast(message, 'error');
      deps.log('notes', message);
    }
  };

  drawToolbar();
  return {
    element: root,
    isShown: () => shown !== null,
    open(id, pos) {
      if (shown !== null) {
        return;
      }
      tool = 'pen';
      colourIndex = 0;
      drawToolbar();
      const entry: Shown = {
        id,
        pos,
        scope: deps.pushScope(),
        session: null,
        changed: false,
      };
      shown = entry;
      void openSession(entry);
    },
    close() {
      const entry = shown;
      if (entry === null) {
        return;
      }
      entry.session?.finishEdit();
      const json =
        entry.changed && entry.session !== null ? entry.session.toJson() : null;
      hide();
      if (json === null) {
        deps.log('notes', `markup closed for image ${entry.pos}`);
        return;
      }
      const save = saveMarkup(entry, json);
      saves = Promise.all([saves, save]).then(() => undefined);
    },
    savesSettled: () => saves,
    setTool(next) {
      const session = sessionNow();
      if (session === null) {
        return;
      }
      tool = next;
      session.setTool(next);
      drawToolbar();
      deps.log('notes', `tool ${next}`);
    },
    stepColour(step) {
      pickColour((colourIndex + step + COLOURS.length) % COLOURS.length);
    },
    undo() {
      const session = sessionNow();
      if (session !== null) {
        session.undo();
        deps.log('notes', 'undo');
      }
    },
    redo() {
      const session = sessionNow();
      if (session !== null) {
        session.redo();
        deps.log('notes', 'redo');
      }
    },
    redrawHints: drawToolbar,
  };
}
