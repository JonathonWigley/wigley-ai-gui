import type { Disposable } from './disposable';

// Agent-written markdown to safe HTML, raw HTML escaped. A link, an autolink
// and a bare URL with a scheme render as an `a.md-link` holding its target in
// `data-href`, whose click the page handles; an image renders as its alt text.
// `block` and `inline` draw only http and https links, any other staying
// literal text; `document` draws every link markdown-it allows, and adds
// heading anchors and highlighted fences. `block` and
// `document` emit a placeholder for each fence whose language has a
// contribution, `document` highlighting a live one's code inside it; the
// markdown mount (`src/shared/page/markdown-mount.ts`) hydrates it. `block`
// also marks each top-level block and top-level list item with
// `data-md-lines="<start>,<end>"`: zero-based source lines, `end` exclusive.
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
