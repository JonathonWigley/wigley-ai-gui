import type { Disposable } from './disposable';

// Agent-written markdown to safe HTML. `block` and `inline` show raw HTML and
// links as literal text; `document` renders a whole doc with links as anchors,
// heading anchors and highlighted fences, raw HTML still escaped. `block` and
// `document` emit a placeholder for each fence whose language has a
// contribution, `document` highlighting a live one's code inside it; the
// markdown mount (`src/shared/page/markdown-mount.ts`) hydrates it.
export interface MarkdownRenderer {
  block(text: string): string;
  inline(text: string): string;
  document(text: string): Promise<string>;
  // Throws on a language already registered.
  addFence(fence: FenceContribution): Disposable;
  fence(language: string): FenceContribution | undefined;
}

export interface FenceView {
  readonly element: HTMLElement;
  dispose(): void;
}

// `closed` is false while the block's closing fence has not arrived (a
// streaming reply). `live` is true when the view runs the source (html), false
// when it only formats it (diff). A draw with liveFences: false skips live
// contributions only.
export interface FenceContribution {
  language: string;
  live: boolean;
  mount(source: string, closed: boolean): FenceView;
}
