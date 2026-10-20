import type { Log } from '../../../../contracts/log';
import type { ToastTone } from '../../../../contracts/plugin';
import { errorText } from '../../../../shared/error-text';
import type { LayoutChoice } from '../../contract';
import type { Layout } from '../../layouts/layout';

export interface LayoutLoaderDeps {
  importModule(url: string): Promise<unknown>;
  dataUrl(path: string, revision: number): string;
  defaultLayout: Layout;
  head: HTMLElement;
}

export interface LayoutLoader {
  load(choice: LayoutChoice): Promise<Layout>;
}

const CARD_KINDS = ['question', 'finding', 'notice'] as const;

// The layout a user's `layout.js` module exports as its default; throws naming
// the first part it lacks.
export function readLayout(module: unknown, name: string): Layout {
  const layout = isRecord(module) ? module.default : undefined;
  if (!isRecord(layout)) {
    throw new Error(
      `layout ${name}: the default export is missing or not an object`,
    );
  }
  const cards = isRecord(layout.cards) ? layout.cards : {};
  for (const kind of CARD_KINDS) {
    if (typeof cards[kind] !== 'function') {
      throw new Error(
        `layout ${name}: cards.${kind} is missing or not a function`,
      );
    }
  }
  const hasValidHead =
    layout.head === undefined || typeof layout.head === 'function';
  if (!hasValidHead) {
    throw new Error(`layout ${name}: head is not a function`);
  }
  return layout as unknown as Layout;
}

// The URLs of a user layout's files in forms' plugin data, at its revision.
export function layoutUrls(
  choice: LayoutChoice,
  dataUrl: (path: string, revision: number) => string,
): { script: string; style: string | null } {
  const folder = `layouts/${choice.name}`;
  return {
    script: dataUrl(`${folder}/layout.js`, choice.revision),
    style: choice.hasCss
      ? dataUrl(`${folder}/layout.css`, choice.revision)
      : null,
  };
}

// Loads each chosen layout, keeping one stylesheet link in `head` for the
// user layout's CSS. The stylesheet changes only once the script has loaded,
// so a failed load keeps the last good look whole.
export function createLayoutLoader(deps: LayoutLoaderDeps): LayoutLoader {
  let link: HTMLLinkElement | null = null;
  const showStyle = (url: string | null) => {
    if (url === null) {
      link?.remove();
      link = null;
      return;
    }
    if (link === null) {
      link = deps.head.ownerDocument.createElement('link');
      link.rel = 'stylesheet';
      deps.head.append(link);
    }
    link.href = url;
  };
  return {
    async load(choice) {
      if (choice.builtIn) {
        showStyle(null);
        return deps.defaultLayout;
      }
      const urls = layoutUrls(choice, deps.dataUrl);
      const layout = readLayout(
        await deps.importModule(urls.script),
        choice.name,
      );
      showStyle(urls.style);
      return layout;
    },
  };
}

// Main's layout channel as the page hears it: `layoutChanged` messages and the
// `layout` answer.
export interface LayoutChannel {
  onLayoutChanged(listener: (choice: LayoutChoice) => void): void;
  readLayout(): Promise<LayoutChoice>;
}

export interface ShowLayoutsDeps {
  channel: LayoutChannel;
  loader: LayoutLoader;
  setLayout(layout: Layout, name: string): void;
  log: Log;
  toast(text: string, tone: ToastTone): void;
}

// Shows main's chosen layout, then each layout main reports changed, loaded
// one at a time in arrival order. A layout that fails to load leaves the
// current one shown. A change heard before main answers `layout` is newer, so
// the answer is then dropped.
export function showLayouts(deps: ShowLayoutsDeps): void {
  const { channel, loader, log, toast } = deps;
  let queue = Promise.resolve();
  let heardChange = false;
  const shown = (layout: Layout, choice: LayoutChoice) => {
    deps.setLayout(layout, choice.name);
    log(
      'forms',
      `layout ${choice.name} shown (${choice.reason}, revision ${choice.revision})`,
    );
    const shownToast = layoutToast(choice);
    if (shownToast !== null) {
      toast(shownToast.text, shownToast.tone);
    }
  };
  const failed = (error: unknown, choice: LayoutChoice) => {
    log('forms', `layout ${choice.name} failed: ${errorText(error)}`);
    toast(`Layout ${choice.name} failed: ${errorText(error)}`, 'error');
  };
  const show = (choice: LayoutChoice) => {
    queue = queue
      .then(() =>
        loader.load(choice).then(
          (layout) => shown(layout, choice),
          (error: unknown) => failed(error, choice),
        ),
      )
      .catch((error: unknown) =>
        log('forms', `layout ${choice.name} not shown: ${errorText(error)}`),
      );
  };
  channel.onLayoutChanged((choice) => {
    heardChange = true;
    show(choice);
  });
  channel
    .readLayout()
    .then((choice) => {
      if (!heardChange) {
        show(choice);
      }
    })
    .catch((error: unknown) =>
      log('forms', `layout not read: ${errorText(error)}`),
    );
}

function layoutToast(
  choice: LayoutChoice,
): { text: string; tone: ToastTone } | null {
  switch (choice.reason) {
    case 'cycled':
      return { text: `Layout: ${choice.name}`, tone: 'info' };
    case 'copied':
      return {
        text: `Layout copied to layouts/${choice.name} in forms' data folder`,
        tone: 'success',
      };
    default:
      return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
