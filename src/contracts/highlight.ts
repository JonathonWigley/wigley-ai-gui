// Code to HTML whose spans carry the code colour style's classes.
export interface CodeHighlighter {
  // HTML of `code` with the code colour style's spans, or null when
  // `language` is unknown. A caller renders a rejected highlight, such as a
  // failed language import, plain too, as it renders null.
  highlight(code: string, language: string): Promise<string | null>;
}
