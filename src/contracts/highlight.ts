// Code to HTML whose `tok-*` spans the syntax theme colours.
export interface CodeHighlighter {
  // HTML of `code` with tok-* spans, or null when `language` is unknown.
  highlight(code: string, language: string): Promise<string | null>;
}
