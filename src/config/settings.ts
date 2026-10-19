import type { Settings } from '../contracts/settings';

export const defaultSettings: Settings = {
  window: { width: 900, height: 700, minWidth: 420, minHeight: 360 },
  theme: 'catppuccin-mocha',
  fonts: {
    ui: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    mono: 'ui-monospace, Menlo, monospace',
    uiSize: 15,
    monoSize: 14,
  },
  keySequenceTimeoutMs: 1000,
};
