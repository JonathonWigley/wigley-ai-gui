import { type AgentEvent, MAIN_AGENT_ID } from '../../../contracts/agent';

// Each session's active time and spend since its run began, added across its
// clears: a clear starts a new process with no spend and resets chat's clock.
// Held in memory only. A session the meter has not seen reads as having none.
export interface RunMeter {
  // Stores a main `usage`'s non-null spend as the process's, and the largest
  // active time seen since the last clear: an old process's event can arrive
  // after chat reset the clock.
  note(sessionId: string, event: AgentEvent): void;
  // Adds the process's spend and the largest active time seen to the carried
  // totals.
  cleared(sessionId: string): void;
  // A workflow first took the flow: what came before counts toward no run.
  claimed(sessionId: string): void;
  // The run so far. `costUsd` is null when no spend was stored since the last
  // `forget`.
  read(sessionId: string): { activeMs: number; costUsd: number | null };
  // The run ended: the next run counts from here.
  finished(sessionId: string): void;
  forget(sessionId: string): void;
}

interface SessionMeter {
  carriedMs: number;
  carriedUsd: number;
  // The running process's cumulative spend; null before its first result.
  processUsd: number | null;
  sampleMs: number;
  baselineMs: number;
  baselineUsd: number;
  hasSpend: boolean;
}

export function createRunMeter(deps: {
  activeMsOf(sessionId: string): number;
}): RunMeter {
  const meters = new Map<string, SessionMeter>();

  const meterOf = (sessionId: string): SessionMeter => {
    const held = meters.get(sessionId);
    if (held !== undefined) {
      return held;
    }
    const meter: SessionMeter = {
      carriedMs: 0,
      carriedUsd: 0,
      processUsd: null,
      sampleMs: 0,
      baselineMs: 0,
      baselineUsd: 0,
      hasSpend: false,
    };
    meters.set(sessionId, meter);
    return meter;
  };

  const totalMs = (sessionId: string, meter: SessionMeter) =>
    meter.carriedMs + deps.activeMsOf(sessionId);

  const totalUsd = (meter: SessionMeter) =>
    meter.carriedUsd + (meter.processUsd ?? 0);

  const startRunHere = (sessionId: string) => {
    const meter = meterOf(sessionId);
    meter.baselineMs = totalMs(sessionId, meter);
    meter.baselineUsd = totalUsd(meter);
  };

  return {
    note(sessionId, event) {
      const meter = meterOf(sessionId);
      const isMainSpend =
        event.type === 'usage' &&
        event.agentId === MAIN_AGENT_ID &&
        event.spendUsd !== null;
      if (isMainSpend) {
        meter.processUsd = event.spendUsd;
        meter.hasSpend = true;
      }
      meter.sampleMs = Math.max(meter.sampleMs, deps.activeMsOf(sessionId));
    },
    cleared(sessionId) {
      const meter = meterOf(sessionId);
      meter.carriedUsd = totalUsd(meter);
      meter.carriedMs += meter.sampleMs;
      meter.processUsd = null;
      meter.sampleMs = 0;
    },
    claimed: startRunHere,
    read(sessionId) {
      const meter = meterOf(sessionId);
      return {
        activeMs: totalMs(sessionId, meter) - meter.baselineMs,
        costUsd: meter.hasSpend ? totalUsd(meter) - meter.baselineUsd : null,
      };
    },
    finished: startRunHere,
    forget(sessionId) {
      meters.delete(sessionId);
    },
  };
}
