// Getting the user's attention without taking the foreground: the app raises
// no system notification, only a count on its Dock or taskbar icon.
export interface Alerts {
  // `source` names the caller (a plugin id); the badge shows the sum of every source's count.
  setOpenCount(source: string, count: number): void;
}
