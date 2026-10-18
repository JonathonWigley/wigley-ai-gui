// Getting the user's attention without taking the foreground.
export interface Alerts {
  // `onClick` runs when the user clicks the alert, where the platform supports it.
  announce(title: string, body: string, onClick: () => void): void;
  setOpenCount(count: number): void;
}
