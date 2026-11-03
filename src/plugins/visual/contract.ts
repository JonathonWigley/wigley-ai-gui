// The visual plugin's channel between its main and page parts, which carries
// nothing: main only registers the layouts and the session note.
export interface VisualChannel {
  invoke: Record<never, never>;
  messages: Record<never, never>;
}
