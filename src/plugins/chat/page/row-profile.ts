import type { PluginLog } from '../../../contracts/log';
import type { Paths } from '../../../contracts/paths';
import { callEach } from '../../../shared/call-each';
import type { DrawnPart } from '../../../shared/page/layout-host/draw-part';
import type { SessionPart } from '../../sessions/contract';
import type { ChatProfile } from '../contract';
import type { RowProfileInput } from '../layouts/layout';
import {
  type ChatLayouts,
  chatPartDraws,
  surfaceBaseKit,
  type SurfaceKitDeps,
} from './chat-layouts';

// `heldProfile` reads the profile of a session chat holds, null for any other;
// `profileDirOf` reads a session row's resolved config folder, null for a row
// with none.
export interface RowProfileDeps {
  layouts: ChatLayouts;
  kit: SurfaceKitDeps;
  paths: Paths;
  homeDir: string;
  log: PluginLog;
  profiles(): readonly ChatProfile[];
  heldProfile(sessionId: string): string | null;
  profileDirOf(sessionId: string): string | null;
}

// `part` is the row part sessions draws under each session row. `profilesChanged`
// draws every kept row again, after chat's profiles setting changed. `changed`
// draws the session's row again when its name changed, after chat's state for
// it changed; a session with no row drawn is ignored.
export interface RowProfile {
  part: SessionPart;
  profilesChanged(): void;
  changed(sessionId: string): void;
}

// A row sessions has drawn the part in: the wrapper it handed the part, the
// layout part drawn into it, null while the row shows nothing, and the name it
// drew.
interface KeptRow {
  sessionId: string;
  wrapper: HTMLElement;
  drawn: DrawnPart<{ element: HTMLElement }> | null;
  name: string | null;
}

// The name of the profile whose config folder is `folder`, else the folder's
// last segment.
export function profileNameOf(
  folder: string,
  profiles: readonly ChatProfile[],
  paths: Paths,
  homeDir: string,
): string {
  const resolved = paths.expandTilde(folder, homeDir);
  const profile = profiles.find((candidate) =>
    paths.samePath(paths.expandTilde(candidate.configDir, homeDir), resolved),
  );
  return profile?.name ?? paths.base(resolved);
}

// Each session's profile under its row, through chat's `rowProfile` layout
// part: a session chat holds by the profile chat opened it under, any other by
// its config folder. A row with neither shows nothing. A layout change or a
// profiles change draws every kept row again.
export function createRowProfile(deps: RowProfileDeps): RowProfile {
  const rows = new Map<string, KeptRow>();
  const draws = chatPartDraws(deps.layouts, 'rowProfile', deps.log);

  const nameOf = (sessionId: string): string | null => {
    const held = deps.heldProfile(sessionId);
    if (held !== null) {
      return held;
    }
    const folder = deps.profileDirOf(sessionId);
    return folder === null
      ? null
      : profileNameOf(folder, deps.profiles(), deps.paths, deps.homeDir);
  };

  const clear = (row: KeptRow) => {
    const { drawn } = row;
    row.drawn = null;
    drawn?.built.element.remove();
    drawn?.dispose();
  };

  const draw = (row: KeptRow) => {
    const name = nameOf(row.sessionId);
    const input: RowProfileInput | null = name === null ? null : { name };
    const next =
      input === null
        ? null
        : draws.draw(row.wrapper, (builder, at, rollback) => {
            const kit = surfaceBaseKit(deps.kit, 'chat', rollback);
            return { element: builder(at, input, kit).element };
          });
    clear(row);
    row.drawn = next;
    row.name = name;
  };

  const drawEveryRow = () => callEach([...rows.values()], draw);
  deps.layouts.onChange(drawEveryRow);

  return {
    part: {
      id: 'chat.rowProfile',
      build(wrapper, sessionId) {
        const earlier = rows.get(sessionId);
        const row: KeptRow = { sessionId, wrapper, drawn: null, name: null };
        rows.set(sessionId, row);
        if (earlier !== undefined) {
          clear(earlier);
        }
        draw(row);
        return {
          dispose() {
            if (rows.get(sessionId) === row) {
              rows.delete(sessionId);
            }
            clear(row);
          },
        };
      },
    },
    profilesChanged: drawEveryRow,
    changed(sessionId) {
      const row = rows.get(sessionId);
      if (row !== undefined && nameOf(sessionId) !== row.name) {
        draw(row);
      }
    },
  };
}
