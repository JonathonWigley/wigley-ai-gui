import type {
  CaptureWindow,
  ScreenCapture,
  ScreenAccess,
  ScreenRect,
  WindowList,
} from '../../contracts/screen-capture';

// One window as the OS lists it: `number` is the id its capture source's id
// carries (`window:<number>:…`).
export interface OsWindow {
  readonly number: number;
  readonly processId: number;
  readonly title: string;
  readonly bounds: ScreenRect;
}

export interface OsWindowLister {
  // The on-screen windows, front to back.
  list(): Promise<readonly OsWindow[]>;
}

export interface ScreenCaptureDeps {
  readonly windows: OsWindowLister;
  // The capture sources of every window, as Electron's desktopCapturer lists them.
  sources(): Promise<readonly { readonly id: string }[]>;
  access(): ScreenAccess;
  // True on macOS: no window source at all means the app has no grant yet.
  readonly blockedWhenNoSources: boolean;
  openSettings(): Promise<void>;
}

// A ScreenCapture over one OS's adapter: each OS window that has a capture
// source, in the OS's front-to-back order, with that source's id. A blocked
// access lists nothing, an undetermined one lists as granted so the OS can
// ask, and a lister or sources call that rejects rejects
// the list with its error.
export function createScreenCapture(deps: ScreenCaptureDeps): ScreenCapture {
  return {
    access: () => deps.access(),
    async listWindows(): Promise<WindowList> {
      if (deps.access() === 'blocked') {
        return { access: 'blocked' };
      }
      const [windows, sources] = await Promise.all([
        deps.windows.list(),
        deps.sources(),
      ]);
      const sourceIds = windowSourceIds(sources);
      if (sourceIds.size === 0 && deps.blockedWhenNoSources) {
        return { access: 'blocked' };
      }
      return { access: 'granted', windows: withSources(windows, sourceIds) };
    },
    openAccessSettings: () => deps.openSettings(),
  };
}

// The id of each window source, by the window number its id carries.
function windowSourceIds(
  sources: readonly { readonly id: string }[],
): Map<number, string> {
  const ids = new Map<number, string>();
  for (const source of sources) {
    const match = /^window:(\d+):/.exec(source.id);
    if (match !== null) {
      ids.set(Number(match[1]), source.id);
    }
  }
  return ids;
}

// `windows` that have a source in `sourceIds`, in their order, each with
// its source's id.
function withSources(
  windows: readonly OsWindow[],
  sourceIds: ReadonlyMap<number, string>,
): CaptureWindow[] {
  const listed: CaptureWindow[] = [];
  for (const window of windows) {
    const sourceId = sourceIds.get(window.number);
    if (sourceId !== undefined) {
      listed.push({
        sourceId,
        processId: window.processId,
        title: window.title,
        bounds: window.bounds,
      });
    }
  }
  return listed;
}
