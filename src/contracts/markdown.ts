// Agent-written markdown to safe HTML. `block` and `inline` show raw HTML and
// links as literal text; `document` renders a whole doc with links as anchors,
// heading anchors and highlighted fences, raw HTML still escaped.
export interface MarkdownRenderer {
  block(text: string): string;
  inline(text: string): string;
  document(text: string): Promise<string>;
}
