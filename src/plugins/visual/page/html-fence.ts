import type { PluginLog } from '../../../contracts/log';
import type { FenceContribution } from '../../../contracts/markdown';
import type { VisualFrames } from '../../../contracts/visual-frames';
import { callEach } from '../../../shared/call-each';
import { element } from '../../../shared/page/dom';
import {
  type Drawn,
  openFrameSlot,
  type VisualParts,
} from './layout/visual-parts';
import type { VisualRegistry } from './visual-registry';

// `expand` is what a visual's expand control runs with its source.
export interface HtmlFenceDeps {
  frames: VisualFrames;
  parts: VisualParts;
  registry: VisualRegistry;
  log: PluginLog;
  expand(source: string): void;
}

// `contribution` is the live `html` fence: each view is a `div.visual-host`
// holding the `card` part while its block is open, and once it is closed the
// `visual` part around a frame opened on its source, its host held in the
// registry under that source until the view's dispose, logged as
// `visual mounted: <title>`. `redraw` draws every live view's part again with
// the layouts last set, moving each view's frame into the new part: it stays
// loaded only when its host is in the document and the part places it in an
// element already there. `dispose` disposes every live view; a view's second
// `dispose` does nothing, so its markdown owner may still call it.
export interface HtmlFence {
  contribution: FenceContribution;
  redraw(): void;
  dispose(): void;
}

// One mounted view: its host, the part drawn in it now, and how to draw that
// part again.
interface LiveView {
  host: HTMLElement;
  drawn: Drawn;
  draw(host: HTMLElement): Drawn;
  dispose(): void;
}

const TITLE = /<title[^>]*>([\s\S]*?)<\/title>/i;

export function createHtmlFence(deps: HtmlFenceDeps): HtmlFence {
  const views = new Set<LiveView>();

  const mountView = (
    host: HTMLElement,
    draw: (host: HTMLElement) => Drawn,
    disposeView: () => void,
  ) => {
    const view: LiveView = {
      host,
      drawn: draw(host),
      draw,
      dispose() {
        if (views.delete(view)) {
          callEach<() => void>(
            [() => view.drawn.dispose(), disposeView],
            (step) => step(),
          );
        }
      },
    };
    views.add(view);
    return { element: host, dispose: view.dispose };
  };

  return {
    contribution: {
      language: 'html',
      live: true,
      mount(source, closed) {
        const host = element('div', 'visual-host');
        if (!closed) {
          return mountView(
            host,
            (into) => deps.parts.card(into),
            () => undefined,
          );
        }
        const { frame, slot } = openFrameSlot(deps.frames, source);
        const registered = deps.registry.add(host, source);
        const view = mountView(
          host,
          (into) => deps.parts.visual(into, slot, () => deps.expand(source)),
          () => {
            registered.dispose();
            frame.dispose();
          },
        );
        deps.log(`visual mounted: ${visualTitle(source)}`);
        return view;
      },
    },
    redraw() {
      callEach([...views], (view) => {
        const next = view.draw(view.host);
        const last = view.drawn;
        view.drawn = next;
        last.dispose();
      });
    },
    dispose() {
      callEach([...views], (view) => view.dispose());
    },
  };
}

// The trimmed text of `source`'s first `<title>`, `untitled` when it has none
// or it is blank.
function visualTitle(source: string): string {
  const title = TITLE.exec(source)?.[1].trim() ?? '';
  return title === '' ? 'untitled' : title;
}
