// Code to HTML whose `tok-*` spans the syntax theme colours.
export interface CodeHighlighter {
  // HTML of `code` with tok-* spans, or null when `language` is unknown. A
  // caller renders a rejected highlight, such as a failed language import,
  // plain too, as it renders null.
  highlight(code: string, language: string): Promise<string | null>;
}
