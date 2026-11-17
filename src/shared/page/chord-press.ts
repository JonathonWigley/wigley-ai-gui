// Whether `event` is a chord the page's keys may take, not typing: Ctrl, Alt or
// Meta held, and AltGr not down. Chromium reports AltGraph only where the
// layout has an AltGr key, and an AltGr press types a character.
export function isChordPress(event: KeyboardEvent): boolean {
  const holdsChordModifier = event.ctrlKey || event.altKey || event.metaKey;
  return holdsChordModifier && !event.getModifierState('AltGraph');
}
