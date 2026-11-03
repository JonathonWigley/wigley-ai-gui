import { createHash } from 'node:crypto';
import { VISUAL_MESSAGES } from '../../shared/visual-messages';
import { visualHashOf, visualUrl } from '../../shared/visual-url';

// Each visual's own CSP: inline script and style and `data:` images and fonts,
// and no network; `default-src 'none'` covers every fetch directive left out.
const VISUAL_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'";

// Runs in the frame before the visual's own scripts: keeps the root hidden
// until the page's first theme message and applies each one, reports the
// height the frame needs on each change of the root's size or the frame's,
// and reports Esc without stopping it. The root hides vertical overflow: a
// scrollbar narrows a width-scaled visual, and the frame then holds it at
// that narrowed height with the scrollbar showing. A visual wider than the
// frame scrolls sideways, so the height adds the horizontal scrollbar's
// thickness, `innerHeight` less the root's `clientHeight`, 0 without one. A
// root that grew by exactly what the frame grew since the last report
// follows the viewport (`min-height: 100vh`), so that size is not reported:
// adding the bar again would grow the frame without end.
const BOOTSTRAP_SCRIPT = `(() => {
  const messages = ${JSON.stringify(VISUAL_MESSAGES)};
  const root = document.documentElement;
  root.style.visibility = 'hidden';
  root.style.overflowY = 'hidden';
  const isMessage = (data, type) =>
    typeof data === 'object' && data !== null && data.type === type;
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || !isMessage(event.data, messages.theme)) {
      return;
    }
    for (const [name, value] of event.data.properties) {
      root.style.setProperty(name, value);
    }
    root.style.colorScheme = event.data.colorScheme;
    root.style.visibility = '';
  });
  let reported = -1;
  let reportedRoot = NaN;
  let reportedViewport = NaN;
  const reportHeight = () => {
    const viewport = window.innerHeight;
    const rootHeight = Math.ceil(root.getBoundingClientRect().height);
    const height = rootHeight + viewport - root.clientHeight;
    const followsViewport =
      viewport !== reportedViewport &&
      rootHeight - reportedRoot === viewport - reportedViewport;
    if (height === reported || followsViewport) {
      return;
    }
    reported = height;
    reportedRoot = rootHeight;
    reportedViewport = viewport;
    window.parent.postMessage({ type: messages.height, height }, '*');
  };
  new ResizeObserver(reportHeight).observe(root);
  window.addEventListener('resize', reportHeight);
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') {
        window.parent.postMessage({ type: messages.escape }, '*');
      }
    },
    true,
  );
})();`;

// The `<!doctype html>` comes first so the document parses in standards mode;
// the source's own doctype, later, is ignored.
const DOCUMENT_HEAD = `<!doctype html>\n<script>${BOOTSTRAP_SCRIPT}</script>\n`;

// The visuals the page handed over, kept in memory by source hash for the
// app's life: `serve` keeps a source and returns its `wigley-visual:` URL, the
// same URL for the same source; `response` answers a request for that URL with
// the document, or 404 for a URL it does not hold.
export interface VisualDocuments {
  serve(source: string): string;
  response(url: string): Response;
}

export function createVisualDocuments(): VisualDocuments {
  const sources = new Map<string, string>();
  return {
    serve: (source) => {
      const hash = createHash('sha256').update(source, 'utf8').digest('hex');
      sources.set(hash, source);
      return visualUrl(hash);
    },
    response: (url) => {
      const hash = visualHashOf(url);
      const source = hash === null ? undefined : sources.get(hash);
      if (source === undefined) {
        return new Response(null, { status: 404 });
      }
      return new Response(DOCUMENT_HEAD + source, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': VISUAL_CSP,
        },
      });
    },
  };
}
