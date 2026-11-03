import type { Log } from '../../../contracts/log';
import type { FenceContribution } from '../../../contracts/markdown';
import type { VisualFrames } from '../../../contracts/visual-frames';
import { callEach } from '../../../shared/call-each';
import { element } from '../../../shared/page/dom';
import type { Drawn, VisualParts } from './layout/visual-parts';

export interface HtmlFenceDeps {
  frames: VisualFrames;
  parts: VisualParts;
  log: Log;
}

// `contribution` is the live `html` fence: each view is a `div.visual-host`
// holding the `card` part while its block is open, and once it is closed the
// `visual` part around a frame opened on its source, logged as
// `visual mounted: <title>`. `redraw` draws every live view's part again with
// the layouts last set, keeping each view's frame loaded.
export interface HtmlFence {
  contribution: FenceContribution;
  redraw(): void;
}

// One mounted view: its host, the part drawn in it now, and how to draw that
// part again.
interface LiveView {
  host: HTMLElement;
  drawn: Drawn;
  draw(host: HTMLElement): Drawn;
}

const TITLE = /<title[^>]*>([\s\S]*?)<\/title>/i;

export function createHtmlFence(deps: HtmlFenceDeps): HtmlFence {
  const views = new Set<LiveView>();

  const mountView = (
    host: HTMLElement,
    draw: (host: HTMLElement) => Drawn,
    disposeView: () => void,
  ) => {
    const view: LiveView = { host, drawn: draw(host), draw };
    views.add(view);
    return {
      element: host,
      dispose() {
        views.delete(view);
        callEach<() => void>(
          [() => view.drawn.dispose(), disposeView],
          (step) => step(),
        );
      },
    };
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
        const frame = deps.frames.open(source);
        const slot = element('div', 'visual-frame-slot');
        slot.append(frame.element);
        const view = mountView(
          host,
          (into) => deps.parts.visual(into, slot),
          () => frame.dispose(),
        );
        deps.log('visual', `visual mounted: ${visualTitle(source)}`);
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
  };
}

// The trimmed text of `source`'s first `<title>`, `untitled` when it has none
// or it is blank.
function visualTitle(source: string): string {
  const title = TITLE.exec(source)?.[1].trim() ?? '';
  return title === '' ? 'untitled' : title;
}
