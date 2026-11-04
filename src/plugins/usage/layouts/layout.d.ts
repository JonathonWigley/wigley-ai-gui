// The usage layout contract: the parts a usage layout draws for the status-bar plan line, each session's line and the
// right-bar details, and the kit each part gets. The app keeps the status-bar slot (always on, at the bar's end), the
// right-bar slot (there only while the details are open), each session's line slot (in its Chat status line, and in
// its tab bar while the usage-tab-line plugin is on), each session's row line slot (under its side-bar row), the open
// state, the shown session and every redraw: on each
// snapshot, each change of the shown session, each layouts set and once a minute.
//
// Every input is already worded for the screen: counts, percents, money and times arrive as text, and each meter's
// fill and tone beside its text.
import type { BaseKit } from '../../../shared/page/layout-host/kit';

export type UsageTone = 'normal' | 'warning' | 'critical';
// `text` is what the meter reads (`42%`, or `180k/300k` for context); `percent` is 0–100.
export interface MeterInput {
  label: string;
  text: string;
  percent: number;
  tone: UsageTone;
}
// One session's line: its context meter, its cache countdown (`cache 42m`, `cache cold`) and its spend (`$1.23`);
// null cache or spend while the session has reported none. `compacting` is the chip naming the trigger while the
// session compacts (`compacting · auto`, `compacting`, `compacting · autocompact`), null otherwise.
export interface SessionLineInput {
  context: MeterInput;
  cache: string | null;
  spend: string | null;
  compacting: string | null;
}
// One session's line under its side-bar row: its context meter.
export interface RowLineInput {
  context: MeterInput;
}
// One plan as the status bar shows it. `note` (`plan loading`, `plan unavailable`, `no plan rows`, `no profiles`)
// stands in place of `plans` when set. `extraUsage` reads as in `DetailsProfileInput`. `stale` is true while the
// plan's last poll failed after a good one.
export interface StatusLinePlanInput {
  plans: readonly MeterInput[];
  extraUsage: string | null;
  note: string | null;
  stale: boolean;
}
// One profile's plan on the status bar.
export interface StatusLineProfileInput extends StatusLinePlanInput {
  name: string;
}
// The status-bar plan line: the shown plan, `profileName` its profile (null when there is no profile at all), and
// every profile's plan in chat's profile order in `profiles`.
export interface StatusLineInput extends StatusLinePlanInput {
  profileName: string | null;
  profiles: readonly StatusLineProfileInput[];
}
// One plan row; `resets` reads `resets in 2h 14m` or `resets now`, null with no reset time.
export interface DetailsRowInput extends MeterInput {
  resets: string | null;
}
// One profile's plan. `extraUsage` reads `$12.34 / $50.00`, `$12.34 / no limit` or `off`, null when the plan has
// none. `freshness` says how old the numbers are; `error` is the last poll's failure.
export interface DetailsProfileInput {
  name: string;
  isDefault: boolean;
  state: 'fresh' | 'stale' | 'error' | 'loading';
  rows: readonly DetailsRowInput[];
  extraUsage: string | null;
  freshness: string;
  error: string | null;
}
// The shown session's context against its autocompact limit, both limits (`limitsDiffer` when both are set and
// unequal), what is left before autocompact, its cache expiry and its spend.
export interface DetailsSessionInput {
  context: MeterInput;
  window: string;
  configuredLimit: string;
  reportedLimit: string;
  remaining: string;
  limitsDiffer: boolean;
  cache: string;
  spend: string;
}
// Every profile in chat's profile order, and the shown session, null while no session with usage shows.
export interface DetailsInput {
  profiles: readonly DetailsProfileInput[];
  session: DetailsSessionInput | null;
}

// The kit every usage part gets.
export interface UsageKit extends BaseKit {
  // A Meter primitive filled to `percent` in `tone`, appended to `parent`.
  meter(parent: HTMLElement, percent: number, tone: UsageTone): HTMLElement;
}

// Each part comes from the first layout that defines it among the `usage.layout` setting and `default`; a part that
// throws, returns no element appended to `parent`, or appends other nodes beside it is drawn by `default` instead.
// Every part appends one element to `parent` and returns it. `statusLine` draws the status-bar plan line,
// `sessionLine` one session's line into the slot its host gives it, a Chat status line or a tab bar while
// usage-tab-line is on (a zero line, context `0k` and no cache or spend, while that session has no usage; while
// `compacting` is set, the default layout draws the chip first and pulses the meter), `rowLine` one session's line
// under its side-bar row (its context `0k` while that session has no usage), and `details` the right-bar details.
export interface Layout {
  statusLine?(
    parent: HTMLElement,
    input: StatusLineInput,
    kit: UsageKit,
  ): HTMLElement;
  sessionLine?(
    parent: HTMLElement,
    input: SessionLineInput,
    kit: UsageKit,
  ): HTMLElement;
  rowLine?(
    parent: HTMLElement,
    input: RowLineInput,
    kit: UsageKit,
  ): HTMLElement;
  details?(
    parent: HTMLElement,
    input: DetailsInput,
    kit: UsageKit,
  ): HTMLElement;
}
// Every member of Layout, required: the built-in `default` defines them all.
export interface CompleteLayout extends Required<Layout> {}
