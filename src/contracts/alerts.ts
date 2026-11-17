// Getting the user's attention without taking the foreground: the app raises
// no system notification, only a count on its Dock or taskbar icon.

// What one source counts, as the Windows overlay names it: `singular` after a
// count of 1 (`1 open agent form`), `plural` after any other count.
export interface AlertNoun {
  readonly singular: string;
  readonly plural: string;
}

export interface Alerts {
  // `source` names the caller (a plugin id) and `noun` what it counts; the badge
  // shows the sum of every source's count.
  setOpenCount(source: string, count: number, noun: AlertNoun): void;
}
