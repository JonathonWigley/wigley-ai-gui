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

export interface PlatformKeys {
  // An Option (Alt) chord matches the physical key, since Option changes the typed character.
  readonly optionMatchesByCode: boolean;
  // A press with AltGr down types a character and is never a chord.
  readonly altGraphTypes: boolean;
}

export interface PlatformPrograms {
  // The program a Claude Code session runs when the
  // claude-code.command setting is empty.
  readonly claude: string;
}

export interface PlatformRelay {
  // The user part of the relay's channel path.
  readonly username: string;
  // The app's main process id: the process a restart asks to quit.
  readonly pid: number;
  // How a relay starts this app.
  readonly launch: {
    readonly command: readonly string[];
    readonly cwd: string;
  };
  // The name the relay's MCP server gives itself, which agents' tool names embed.
  readonly serverName: string;
}

// What differs by the OS the app runs on, as JSON: main serves it in the config,
// so the page reads the same record.
export interface Platform {
  readonly os: OsName;
  readonly lifecycle: PlatformLifecycle;
  readonly keys: PlatformKeys;
  readonly programs: PlatformPrograms;
  readonly relay: PlatformRelay;
}
