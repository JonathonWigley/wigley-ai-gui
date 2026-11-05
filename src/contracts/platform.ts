// The OS the app runs on.
export type OsName = 'macos' | 'windows' | 'linux';

export interface PlatformLifecycle {
  // Closing the window hides it until the app quits.
  readonly closeHidesWindow: boolean;
  // The OS shows a toast only for an app with an AppUserModelID.
  readonly toastsNeedAppUserModelId: boolean;
  // A self-test or drive run stays out of the Dock.
  readonly hidesFromDockBesideApp: boolean;
}

export interface PlatformPrograms {
  // The default of the `claude.command` setting.
  readonly claude: string;
}

export interface PlatformRelay {
  // The user part of the relay's channel path.
  readonly username: string;
  // How a relay starts this app.
  readonly launch: {
    readonly command: readonly string[];
    readonly cwd: string;
  };
}

// What differs by the OS the app runs on, as JSON: main serves it in the config,
// so the page reads the same record.
export interface Platform {
  readonly os: OsName;
  readonly lifecycle: PlatformLifecycle;
  readonly programs: PlatformPrograms;
  readonly relay: PlatformRelay;
}
