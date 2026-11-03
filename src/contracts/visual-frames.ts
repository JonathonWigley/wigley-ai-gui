export interface VisualFrame {
  readonly element: HTMLElement;
  dispose(): void;
}

export interface VisualFrames {
  // Opens `source` as a live visual: a sandboxed frame, served by main, styled
  // by the page's theme and sized to its content's full height.
  // The caller places `element` once. A move by `Element.moveBefore` between
  // connected parents keeps the visual loaded; any other move (an append,
  // `replaceChildren`, a detach and re-attach) reloads it, and its scripts
  // start again with their state lost.
  // `dispose` removes `element` and stops the visual.
  open(source: string): VisualFrame;
}
