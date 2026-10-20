import type { LayoutChoice } from '../../contracts/layouts';
import type { Log } from '../../contracts/log';
import type { ToastTone } from '../../contracts/plugin';
import { errorText } from '../error-text';

export interface LayoutLoaderDeps<L> {
  importModule(url: string): Promise<unknown>;
  dataUrl(path: string, revision: number): string;
  defaultLayout: L;
  head: HTMLElement;
  // The plugin's layout validator: the layout a user's `layout.js` module
  // holds, or a throw naming the first part it lacks.
  read(module: unknown, name: string): L;
}

export interface LayoutLoader<L> {
  load(choice: LayoutChoice): Promise<L>;
}

// The URLs of a user layout's files in the plugin's data folder, at its revision.
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
export function createLayoutLoader<L>(
  deps: LayoutLoaderDeps<L>,
): LayoutLoader<L> {
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
      const layout = deps.read(
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

export interface ShowLayoutsDeps<L> {
  channel: LayoutChannel;
  loader: LayoutLoader<L>;
  setLayout(layout: L, name: string): void;
  log: Log;
  // The source name every log line carries.
  logSource: string;
  // How the copied toast names the plugin's data folder.
  dataFolderLabel: string;
  toast(text: string, tone: ToastTone): void;
}

// Shows main's chosen layout, then each layout main reports changed, loaded
// one at a time in arrival order. A layout that fails to load leaves the
// current one shown. A change heard before main answers `layout` is newer, so
// the answer is then dropped.
export function showLayouts<L>(deps: ShowLayoutsDeps<L>): void {
  const { channel, loader, log, logSource, toast } = deps;
  let queue = Promise.resolve();
  let heardChange = false;
  const shown = (layout: L, choice: LayoutChoice) => {
    deps.setLayout(layout, choice.name);
    log(
      logSource,
      `layout ${choice.name} shown (${choice.reason}, revision ${choice.revision})`,
    );
    const shownToast = layoutToast(choice, deps.dataFolderLabel);
    if (shownToast !== null) {
      toast(shownToast.text, shownToast.tone);
    }
  };
  const failed = (error: unknown, choice: LayoutChoice) => {
    log(logSource, `layout ${choice.name} failed: ${errorText(error)}`);
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
        log(logSource, `layout ${choice.name} not shown: ${errorText(error)}`),
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
      log(logSource, `layout not read: ${errorText(error)}`),
    );
}

function layoutToast(
  choice: LayoutChoice,
  dataFolderLabel: string,
): { text: string; tone: ToastTone } | null {
  switch (choice.reason) {
    case 'cycled':
      return { text: `Layout: ${choice.name}`, tone: 'info' };
    case 'copied':
      return {
        text: `Layout copied to layouts/${choice.name} in ${dataFolderLabel}`,
        tone: 'success',
      };
    default:
      return null;
  }
}
