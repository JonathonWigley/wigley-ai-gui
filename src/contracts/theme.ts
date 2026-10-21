// What a token's value must be, which the theme loader checks it by: `raw`
// is any CSS text, such as a gradient, an easing curve or a font stack.
export type TokenKind =
  | 'color'
  | 'length'
  | 'duration'
  | 'number'
  | 'shadow'
  | 'filter'
  | 'raw';

// A plugin's theme token: its kind, and the value it takes when the theme sets
// none, written as a theme would write it.
export interface TokenDecl {
  kind: TokenKind;
  default: string;
}

export type ColorScheme = 'dark' | 'light';

// Every token resolved: keys are core names (`fg-secondary`) and qualified
// plugin names (`forms.origin-caused`); values are CSS text ready for a custom
// property. `reduced` holds the overrides in force while transparency is
// reduced.
export interface Theme {
  name: string;
  colorScheme: ColorScheme;
  tokens: Record<string, string>;
  reduced: Record<string, string>;
}
