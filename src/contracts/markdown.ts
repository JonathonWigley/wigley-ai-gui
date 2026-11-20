import type { Disposable } from './disposable';

// Agent-written markdown to safe HTML, raw HTML escaped. A link, an autolink
// and a bare URL with a scheme render as an `a.md-link` holding its target in
// `data-href`, whose click the page handles. An image of a local file by
// absolute path renders as an `img.md-picture` on the visual scheme's local
// media route, a `.mp4` or `.webm` one as a muted, looping `video.md-picture`
// with its controls; a web image renders as its alt text. In `block` and `inline`
// any other image, and a link to a local file, renders as its markdown source;
// in `document` any other image renders as its alt text.
// `block` and `inline` draw only http and https links, any other staying
// text; `document` draws every link markdown-it allows, and adds
// heading anchors and highlighted fences. `block` and
// `document` emit a placeholder for each fence whose language has a
// contribution, `document` highlighting a live one's code inside it; the
// markdown mount (`src/shared/page/markdown-mount.ts`) hydrates it. `block`
// and `document` draw each registered `:::name` block, from its opener to its
// bare `:::` close line, or to the end of the text when none closes it. `block`
// also marks each top-level block and top-level list item with
// `data-md-lines="<start>,<end>"`: zero-based source lines, `end` exclusive.
export interface MarkdownRenderer {
  block(text: string): string;
  inline(text: string): string;
  document(text: string): Promise<string>;
  // Throws on a language already registered.
  addFence(fence: FenceContribution): Disposable;
  fence(language: string): FenceContribution | undefined;
  // Throws on a name already registered, or one not matching `[a-z][a-z0-9-]*`.
  addBlock(block: BlockContribution): Disposable;
}

const BLOCK_NAME = /^[a-z][a-z0-9-]*$/;

// Why `name` cannot name a block, or null: the rule `addBlock` throws on, kept
// here so every `MarkdownRenderer` and its test double refuse the same names.
export function blockNameProblem(name: string): string | null {
  return BLOCK_NAME.test(name)
    ? null
    : `block name "${name}" must match [a-z][a-z0-9-]*`;
}

// A `:::name header` block. `render` returns the block's HTML, which the
// renderer trusts; a `render` that throws draws the block's opener and body as
// escaped text, one paragraph per line.
export interface BlockContribution {
  name: string;
  render(block: MarkdownBlock, helpers: BlockHelpers): string;
}

// `header` is the opener's text after the name, trimmed, or `''`. `body` holds
// one string per source line between the opener and its close line: the line's
// trimmed text behind one space per column of indent, a blank line as `''`.
export interface MarkdownBlock {
  header: string;
  body: readonly string[];
}

// `block` and `inline` return a marker that stands in `render`'s HTML for the
// markdown they draw. `block` given a run of whole body lines draws them in
// place, keeping their source lines; any other text draws with no line marks.
// `escape` escapes text for HTML.
export interface BlockHelpers {
  block(text: string): string;
  inline(text: string): string;
  escape(text: string): string;
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
