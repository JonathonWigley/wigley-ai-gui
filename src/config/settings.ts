import type { Settings } from '../contracts/settings';

export const defaultSettings: Settings = {
  window: { width: 900, height: 700 },
  theme: 'catppuccin-mocha',
  fonts: {
    ui: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    mono: 'ui-monospace, Menlo, monospace',
    uiSize: 14,
    monoSize: 13,
  },
  keySequenceTimeoutMs: 1000,
};
