import type { ColorScheme } from '../contracts/theme';

// The messages the page and a visual's frame trade through `postMessage`. The
// frame's origin is opaque, so each side checks the event's `source` (the
// frame checks `window.parent`, the page checks the frame's `contentWindow`),
// never its origin.
export const VISUAL_MESSAGES = {
  theme: 'wigley-visual:theme',
  height: 'wigley-visual:height',
  escape: 'wigley-visual:escape',
} as const;

// The page's theme as its theme applier wrote it: each custom property in
// write order (the tokens, then the reduced overrides while transparency is
// reduced, then the font settings), and the colour scheme.
export interface VisualTheme {
  properties: readonly (readonly [name: string, value: string])[];
  colorScheme: ColorScheme;
}

// Page → frame, on the frame's load and on every theme change.
export interface VisualThemeMessage extends VisualTheme {
  type: typeof VISUAL_MESSAGES.theme;
}

// Frame → page: the frame document's root element height, in CSS pixels,
// rounded up, each time it changes.
export interface VisualHeightMessage {
  type: typeof VISUAL_MESSAGES.height;
  height: number;
}

// Frame → page: the user pressed Esc inside the frame.
export interface VisualEscapeMessage {
  type: typeof VISUAL_MESSAGES.escape;
}
