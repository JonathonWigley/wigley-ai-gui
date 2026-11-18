import type { TokenKind } from '../contracts/theme';

// Every core theme token by name, with its kind. Its value lives only in a
// theme file: a theme with no `extends` sets every one, and a view reads it
// as `--wg-<name>`. Every key stays quoted, one per line, so a line scan can
// list the token names.
// prettier-ignore
export const coreThemeTokens: Readonly<Record<string, TokenKind>> = {
  // Text
  'fg': 'color',
  'fg-secondary': 'color',
  'fg-tertiary': 'color',
  'fg-disabled': 'color',
  'fg-on-accent': 'color',
  'fg-link': 'color',

  // Accent
  'accent': 'color',
  'accent-hover': 'color',
  'accent-tint': 'color',
  'accent-tint-strong': 'color',
  'focus-border': 'color',

  // Status
  'status-running': 'color',
  'status-success': 'color',
  'status-warning': 'color',
  'status-attention': 'color',
  'status-error': 'color',
  'status-info': 'color',
  'status-running-tint': 'color',
  'status-success-tint': 'color',
  'status-warning-tint': 'color',
  'status-attention-tint': 'color',
  'status-error-tint': 'color',
  'status-info-tint': 'color',

  // Surfaces
  'window-background': 'color',
  'window-ambient': 'raw',
  'editor-background': 'color',
  'transcript-background': 'color',
  'terminal-background': 'color',
  'sheet-background': 'color',
  'sheet-gutter': 'length',
  'block-background': 'color',
  'card-background': 'color',
  'card-border': 'color',
  'input-background': 'color',
  'input-border': 'color',
  'input-placeholder': 'color',

  // Lists
  'list-hover-background': 'color',
  'list-active-background': 'color',
  'list-active-foreground': 'color',
  'list-inactive-selection-background': 'color',
  'tree-indent-guide': 'color',

  // Tabs
  'tab-active-background': 'color',
  'tab-inactive-background': 'color',
  'tab-active-foreground': 'color',
  'tab-inactive-foreground': 'color',
  'tab-active-indicator': 'color',

  // Buttons
  'button-primary-background': 'color',
  'button-primary-foreground': 'color',
  'button-primary-hover': 'color',
  'button-secondary-background': 'color',
  'button-secondary-hover': 'color',
  'button-ghost-hover': 'color',

  // Diffs
  'diff-inserted-background': 'color',
  'diff-removed-background': 'color',
  'diff-inserted-mark': 'color',
  'diff-removed-mark': 'color',
  'diff-changed-mark': 'color',

  // Editor
  'selection-background': 'color',
  'cursor': 'color',
  'line-number': 'color',
  'line-number-active': 'color',
  'editor-active-line': 'color',

  // Borders
  'border-subtle': 'color',
  'border-default': 'color',
  'border-strong': 'color',

  // Materials
  'material-chrome-bg': 'color',
  'material-chrome-bg-dense': 'color',
  'material-chrome-filter': 'filter',
  'material-chrome-edge': 'color',
  'material-floating-bg': 'color',
  'material-floating-filter': 'filter',
  'material-floating-edge': 'color',
  'material-floating-highlight': 'shadow',
  'material-floating-shadow': 'shadow',
  'scrim': 'color',

  // Type
  'font-ui': 'raw',
  'font-mono': 'raw',
  'text-11': 'length',
  'text-12': 'length',
  'text-13': 'length',
  'text-14': 'length',
  'text-16': 'length',
  'text-20': 'length',
  'text-ui': 'length',
  'text-mono': 'length',
  'text-prose': 'length',
  'leading-tight': 'number',
  'leading-ui': 'number',
  'leading-prose': 'number',
  'prose-measure': 'length',
  'weight-regular': 'number',
  'weight-medium': 'number',
  'weight-semibold': 'number',

  // Space
  'space-0_5': 'length',
  'space-1': 'length',
  'space-1_5': 'length',
  'space-2': 'length',
  'space-3': 'length',
  'space-4': 'length',
  'space-6': 'length',
  'space-8': 'length',

  // Size
  'row-tree': 'length',
  'row-list': 'length',
  'tab-height': 'length',
  'toolbar-height': 'length',
  'statusbar-height': 'length',
  'activitybar-width': 'length',
  'icon-button-sm': 'length',
  'icon-button': 'length',
  'icon-size': 'length',
  'sidebar-width': 'length',
  'rightbar-width': 'length',
  'traffic-light-inset': 'length',

  // Shape
  'radius-sm': 'length',
  'radius-md': 'length',
  'radius-lg': 'length',
  'radius-xl': 'length',
  'indicator-width': 'length',

  // Motion
  'duration-fast': 'duration',
  'duration-base': 'duration',
  'duration-slow': 'duration',
  'duration-instant': 'duration',
  'duration-pulse': 'duration',
  'ease-out': 'raw',
  'ease-in': 'raw',

  // Layering
  'z-chrome': 'number',
  'z-floating': 'number',
  'z-dialog': 'number',
  'z-toast': 'number',
};
