import type { PluginLog } from '../../../contracts/log';
import type {
  MarkupEditor,
  MarkupSession,
  MarkupTool,
} from '../../../contracts/markup';
import type {
  PageChannel,
  PushedScope,
  ToastTone,
} from '../../../contracts/plugin';
import { errorText } from '../../../shared/error-text';
import { element } from '../../../shared/page/dom';
import type { NoteDraft, NotesChannel } from '../contract';
import type { MarkupColour } from '../layouts/layout';
import {
  type DrawnToolbar,
  MARKUP_COLOURS,
  type NotesParts,
} from './layout/notes-parts';

export interface MarkupViewDeps {
  channel: PageChannel<NotesChannel>;
  markup: MarkupEditor;
  // The popup's parts, which the toolbar draws through.
  parts: NotesParts;
  // Pushes the `markup` scope.
  pushScope(): PushedScope;
  // The PNG bytes of image `id`.
  imageBytes(id: number): Promise<Uint8Array>;
  // The view hid: the popup shows its fields again.
  closed(): void;
  // Main saved the markup and answered with the draft.
  saved(draft: NoteDraft): void;
  log: PluginLog;
  toast(text: string, tone: ToastTone): void;
}

// One image under markup: a toolbar of the tools and colours, drawn through
// the parts' `markupToolbar`, and the host the markup editor draws in. `open`
// pushes the `markup` scope and shows the image's saved markup with the pen
// and the first colour; `close` ends a text still being edited, pops the
// scope, tells `closed`, then saves the markup when it changed since `open`.
// The tool, colour, undo and redo calls do nothing until the editor has
// opened.
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
  // Sets the pen to the markup colour `colour` names; a name outside
  // `MARKUP_COLOURS` logs `no markup colour <colour>` and changes nothing.
  pickColourByName(colour: string): void;
  undo(): void;
  redo(): void;
  // Draws the toolbar again with the parts' shown layouts; an open markup
  // session is kept.
  redrawToolbar(): void;
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
function readColour(colour: MarkupColour): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(`--wg-notes-markup-${colour}`)
    .trim();
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

  const { parts } = deps;
  // The tool and colour buttons the toolbar's last draw holds.
  let buttons: Pick<DrawnToolbar, 'tools' | 'colours'> = {
    tools: [],
    colours: [],
  };
  const drawToolbar = () => {
    buttons = parts.markupToolbar(toolbar);
    markActive();
  };

  // Marks the tool and colour in use.
  const markActive = () => {
    for (const entry of buttons.tools) {
      entry.node.classList.toggle('is-active', entry.tool === tool);
    }
    for (const entry of buttons.colours) {
      entry.node.classList.toggle(
        'is-active',
        entry.colour === MARKUP_COLOURS[colourIndex],
      );
    }
  };

  const sessionNow = (): MarkupSession | null => shown?.session ?? null;

  const pickColour = (index: number) => {
    const session = sessionNow();
    if (session === null) {
      return;
    }
    colourIndex = index;
    const colour = MARKUP_COLOURS[index];
    session.setColour(readColour(colour));
    markActive();
    deps.log(`colour ${colour}`);
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
      session.setColour(readColour(MARKUP_COLOURS[colourIndex]));
      deps.log(`markup shown for image ${entry.pos}`);
    } catch (error) {
      if (shown !== entry) {
        return;
      }
      const message = `Markup not opened: ${errorText(error)}`;
      deps.toast(message, 'error');
      deps.log(message);
      hide();
    }
  };

  const saveMarkup = async (entry: Shown, json: string) => {
    try {
      const draft = await deps.channel.invoke('saveMarkup', entry.id, json);
      deps.saved(draft);
      deps.log(`markup saved for image ${entry.pos}`);
    } catch (error) {
      const message = `Markup not saved: ${errorText(error)}`;
      deps.toast(message, 'error');
      deps.log(message);
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
      markActive();
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
        deps.log(`markup closed for image ${entry.pos}`);
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
      markActive();
      deps.log(`tool ${next}`);
    },
    stepColour(step) {
      pickColour(
        (colourIndex + step + MARKUP_COLOURS.length) % MARKUP_COLOURS.length,
      );
    },
    pickColourByName(colour) {
      const index = MARKUP_COLOURS.indexOf(colour as MarkupColour);
      if (index === -1) {
        deps.log(`no markup colour ${colour}`);
        return;
      }
      pickColour(index);
    },
    undo() {
      const session = sessionNow();
      if (session !== null) {
        session.undo();
        deps.log('undo');
      }
    },
    redo() {
      const session = sessionNow();
      if (session !== null) {
        session.redo();
        deps.log('redo');
      }
    },
    redrawToolbar: drawToolbar,
  };
}
