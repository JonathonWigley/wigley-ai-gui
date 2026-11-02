import { describe, expect, it } from 'vitest';
import { rateLimitRows, readPlanUsage } from './plan-usage';

// Measured lines, docs/features/agent-chat/claude-stream.md § Usage and § Other events.
const REPORT_LINE =
  '{"type":"assistant","message":{"id":"msg_usage","type":"message","role":"assistant","content":[{"type":"text","text":"usage"}]},"usage_report":{"session":{"total_cost_usd":0,"model_usage":{}},"rate_limits":{"limits":[{"kind":"session","group":"session","percent":35,"resets_at":"2026-10-31T08:09:59.607264+00:00","scope":null,"severity":"normal","is_active":false},{"kind":"weekly_all","group":"weekly","percent":97,"resets_at":"2026-10-31T05:59:59.607290+00:00","scope":null,"severity":"critical","is_active":true},{"kind":"weekly_scoped","group":"weekly","percent":0,"resets_at":"2026-10-31T06:00:00+00:00","scope":{"model":{"display_name":"Fable"},"surface":null},"severity":"normal","is_active":false}],"extra_usage":{"is_enabled":false,"monthly_limit":null,"used_credits":null,"utilization":null,"currency":null}}}}';
const RATE_LIMIT_LINE =
  '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning","resetsAt":1793426400,"rateLimitType":"seven_day","utilization":0.95,"overageStatus":"rejected","overageDisabledReason":"org_level_disabled","isUsingOverage":false,"surpassedThreshold":0.75,"unifiedWindows":{"five_hour":{"utilization":0.12,"resetsAt":1793434200,"status":"allowed"},"seven_day":{"utilization":0.95,"resetsAt":1793426400,"status":"allowed_warning","surpassedThreshold":0.75}},"overageEnabled":false}}';

const INIT_LINE = '{"type":"system","subtype":"init"}';
const RESULT_LINE =
  '{"type":"result","subtype":"success","is_error":false,"result":"usage"}';

// A `/usage` assistant line whose report holds `rateLimits`.
function reportLine(rateLimits: object): string {
  return JSON.stringify({
    type: 'assistant',
    message: { id: 'msg_usage', content: [] },
    usage_report: { rate_limits: rateLimits },
  });
}

describe('readPlanUsage', () => {
  it('readPlanUsage_MeasuredReport_RowsInServerOrder', () => {
    const stdout = [INIT_LINE, REPORT_LINE, RESULT_LINE].join('\n');

    expect(readPlanUsage(stdout, 5000)).toEqual({
      rows: [
        {
          kind: 'session',
          group: 'session',
          label: '5h',
          percent: 35,
          resetsAt: 1793434199607,
          severity: 'normal',
          isActive: false,
        },
        {
          kind: 'weekly_all',
          group: 'weekly',
          label: 'Week',
          percent: 97,
          resetsAt: 1793426399607,
          severity: 'critical',
          isActive: true,
        },
        {
          kind: 'weekly_scoped',
          group: 'weekly',
          label: 'Fable',
          percent: 0,
          resetsAt: 1793426400000,
          severity: 'normal',
          isActive: false,
        },
      ],
      extraUsage: {
        enabled: false,
        usedMinor: null,
        limitMinor: null,
        currency: null,
      },
      at: 5000,
    });
  });

  it.each([
    {
      name: 'ScopeModel',
      kind: 'weekly_scoped',
      scope: { model: { display_name: 'Fable' }, surface: null },
      label: 'Fable',
    },
    {
      name: 'ScopeSurface',
      kind: 'weekly_scoped',
      scope: { model: null, surface: { display_name: 'Claude Code' } },
      label: 'Claude Code',
    },
    { name: 'Session', kind: 'session', scope: null, label: '5h' },
    { name: 'WeeklyAll', kind: 'weekly_all', scope: null, label: 'Week' },
    {
      name: 'UnknownKind',
      kind: 'weekly_opus',
      scope: null,
      label: 'weekly_opus',
    },
  ])('readPlanUsage_Label_$name', ({ kind, scope, label }) => {
    const stdout = reportLine({ limits: [{ kind, percent: 12, scope }] });

    expect(readPlanUsage(stdout, 0).rows[0].label).toBe(label);
  });

  it.each([
    { name: 'Code', currency: 'EUR', expected: 'EUR' },
    { name: 'LowerCase', currency: 'usd', expected: null },
    { name: 'TwoLetters', currency: 'US', expected: null },
    { name: 'Symbol', currency: '$', expected: null },
    { name: 'NotAString', currency: 840, expected: null },
  ])('readPlanUsage_Currency_$name', ({ currency, expected }) => {
    const stdout = reportLine({
      limits: [{ kind: 'session', percent: 1 }],
      extra_usage: { is_enabled: true, currency },
    });

    expect(readPlanUsage(stdout, 0).extraUsage?.currency).toBe(expected);
  });

  it('readPlanUsage_ExtraUsageOn_KeepsAmounts', () => {
    const stdout = reportLine({
      limits: [{ kind: 'session', percent: 1 }],
      extra_usage: {
        is_enabled: true,
        monthly_limit: 5000,
        used_credits: 1250,
        currency: 'USD',
      },
    });

    expect(readPlanUsage(stdout, 0).extraUsage).toEqual({
      enabled: true,
      usedMinor: 1250,
      limitMinor: 5000,
      currency: 'USD',
    });
  });

  it.each([
    { name: 'EmptyStdout', stdout: '', reason: 'printed no usage report' },
    {
      name: 'ResultOnly',
      stdout: RESULT_LINE,
      reason: 'printed no usage report',
    },
    {
      name: 'AssistantWithoutReport',
      stdout: JSON.stringify({
        type: 'assistant',
        message: { content: [] },
      }),
      reason: 'printed no usage report',
    },
    {
      name: 'NoLimits',
      stdout: reportLine({ limits: [] }),
      reason: 'reported no plan limits',
    },
    {
      name: 'NoPercent',
      stdout: reportLine({
        limits: [{ kind: 'session' }, { kind: 'weekly_all', percent: '9' }],
      }),
      reason: 'reported no plan limits',
    },
  ])('readPlanUsage_Rejects_$name', ({ stdout, reason }) => {
    expect(() => readPlanUsage(stdout, 0)).toThrow(reason);
  });
});

describe('rateLimitRows', () => {
  it('rateLimitRows_MeasuredEvent_SessionAndWeekly', () => {
    const info = JSON.parse(RATE_LIMIT_LINE).rate_limit_info;

    expect(rateLimitRows(info)).toEqual([
      {
        kind: 'session',
        percent: 12,
        resetsAt: 1793434200000,
        severity: 'normal',
      },
      {
        kind: 'weekly_all',
        percent: 95,
        resetsAt: 1793426400000,
        severity: 'warning',
      },
    ]);
  });

  it.each([
    { status: 'allowed', severity: 'normal' },
    { status: 'allowed_warning', severity: 'warning' },
    { status: 'rejected', severity: 'critical' },
    { status: 'throttled', severity: 'normal' },
  ])('rateLimitRows_Status_$status', ({ status, severity }) => {
    const info = {
      unifiedWindows: {
        five_hour: { utilization: 0.4, resetsAt: 1793434200, status },
      },
    };

    expect(rateLimitRows(info)).toEqual([
      { kind: 'session', percent: 40, resetsAt: 1793434200000, severity },
    ]);
  });

  it.each([
    { name: 'NoWindows', info: { status: 'allowed' } },
    {
      name: 'NoUtilization',
      info: { unifiedWindows: { five_hour: { status: 'allowed' } } },
    },
  ])('rateLimitRows_NoRow_$name', ({ info }) => {
    expect(rateLimitRows(info)).toBeNull();
  });
});
