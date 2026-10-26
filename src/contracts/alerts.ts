// Getting the user's attention without taking the foreground.
export interface Alerts {
  // `onClick` runs when the user clicks the alert, where the platform supports it.
  announce(title: string, body: string, onClick: () => void): void;
  // `source` names the caller (a plugin id); the badge shows the sum of every source's count.
  setOpenCount(source: string, count: number): void;
}
