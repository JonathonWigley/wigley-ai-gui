// Agent-written markdown to safe HTML; raw HTML and links show as literal text.
export interface MarkdownRenderer {
  block(text: string): string;
  inline(text: string): string;
}
