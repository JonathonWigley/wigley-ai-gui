export const THEME_TOKENS = [
  'bg.base',
  'bg.pane',
  'bg.deep',
  'surface',
  'surface.hover',
  'surface.selected',
  'border',
  'border.focus',
  'text',
  'text.muted',
  'text.faint',
  'text.onAccent',
  'accent',
  'recommend',
  'link',
  'success',
  'warning',
  'error',
  'info',
  'change.added',
  'change.changed',
  'change.removed',
  'selection',
  'cursor',
  'editor.bg',
  'editor.fg',
  'editor.activeLine',
  'editor.gutter',
  'editor.selection',
  'editor.cursor',
  'whichKey.command',
  'whichKey.prefix',
  'origin.caused',
  'origin.preExisting',
  'origin.design',
  'origin.nit',
  'severity.critical',
  'severity.important',
  'severity.minor',
  'syntax.keyword',
  'syntax.atom',
  'syntax.number',
  'syntax.string',
  'syntax.string2',
  'syntax.comment',
  'syntax.variable',
  'syntax.variable2',
  'syntax.definition',
  'syntax.property',
  'syntax.type',
  'syntax.operator',
  'syntax.punctuation',
  'syntax.meta',
  'syntax.heading',
  'syntax.link',
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];

// A theme with every token resolved to a `#rrggbb` or `#rrggbbaa` colour.
export interface Theme {
  name: string;
  tokens: Record<ThemeToken, string>;
}

// The theme in use, and a theme problem to show the user, or null.
export interface ThemeChoice {
  theme: Theme;
  error: string | null;
}
