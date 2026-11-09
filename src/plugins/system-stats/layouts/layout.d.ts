// The system-stats layout contract: what a layout in `layouts/system-stats/<name>/layout.js` draws the right-bar
// panel with. The parts and their inputs are filled in with the page part.
import type { BaseKit } from '../../../shared/page/layout-host/kit';

export interface Layout {}
// Every member of Layout, required: the built-in `default` defines them all.
export interface CompleteLayout extends Required<Layout> {}
