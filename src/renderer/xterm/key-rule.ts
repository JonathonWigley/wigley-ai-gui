// The one key a terminal screen passes on to the page keys; the shell gets
// every other key.
export function passesToPage(key: string): boolean {
  return key === 'Escape';
}
