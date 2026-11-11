import type { ProcessRunner } from '../../contracts/processes';
import { requiredStdout } from '../processes/required-stdout';
import type { OsWindow, OsWindowLister } from './screen-capture';
import { parseWindowRows } from './window-rows';

const RUN_TIMEOUT_MS = 10000;

const POWERSHELL = 'powershell.exe';

// The pixels per inch of a window at 100% scale.
const BASE_DPI = 96;

// One JSON array of the visible, unminimized, uncloaked top-level windows, in
// EnumWindows' z-order (front to back): each window's HWND as a decimal
// `number`, its owning `processId`, `title`, DWM extended frame bounds in
// physical pixels (`left`, `top`, `right`, `bottom`) and `dpi`. The C# is the
// reason the script holds `"`, so it runs through `-EncodedCommand`.
export const WINDOWS_WINDOW_LIST_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
  'Add-Type -TypeDefinition @"',
  'using System;',
  'using System.Collections.Generic;',
  'using System.Runtime.InteropServices;',
  'using System.Text;',
  'public sealed class WigleyWindowRow {',
  '  public long number { get; set; }',
  '  public uint processId { get; set; }',
  '  public string title { get; set; }',
  '  public int left { get; set; }',
  '  public int top { get; set; }',
  '  public int right { get; set; }',
  '  public int bottom { get; set; }',
  '  public uint dpi { get; set; }',
  '}',
  'public static class WigleyWindowList {',
  '  private const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;',
  '  private const int DWMWA_CLOAKED = 14;',
  '  private static readonly IntPtr PER_MONITOR_AWARE_V2 = new IntPtr(-4);',
  '  [StructLayout(LayoutKind.Sequential)]',
  '  private struct Rect { public int Left; public int Top; public int Right; public int Bottom; }',
  '  private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);',
  '  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);',
  '  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);',
  '  [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hwnd);',
  '  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);',
  '  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextLength(IntPtr hwnd);',
  '  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int maxCount);',
  '  [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr hwnd);',
  '  [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);',
  '  [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);',
  '  [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out Rect value, int size);',
  '  public static WigleyWindowRow[] List() {',
  '    SetThreadDpiAwarenessContext(PER_MONITOR_AWARE_V2);',
  '    List<WigleyWindowRow> rows = new List<WigleyWindowRow>();',
  '    EnumWindows(delegate (IntPtr hwnd, IntPtr lParam) {',
  '      WigleyWindowRow row = Read(hwnd);',
  '      if (row != null) { rows.Add(row); }',
  '      return true;',
  '    }, IntPtr.Zero);',
  '    return rows.ToArray();',
  '  }',
  '  private static WigleyWindowRow Read(IntPtr hwnd) {',
  '    if (!IsWindowVisible(hwnd) || IsIconic(hwnd)) { return null; }',
  '    int cloaked;',
  '    bool isCloaked = DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, out cloaked, sizeof(int)) == 0 && cloaked != 0;',
  '    if (isCloaked) { return null; }',
  '    Rect frame;',
  '    bool hasFrame = DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, out frame, Marshal.SizeOf(typeof(Rect))) == 0;',
  '    bool isEmpty = frame.Right <= frame.Left || frame.Bottom <= frame.Top;',
  '    if (!hasFrame || isEmpty) { return null; }',
  '    uint dpi = GetDpiForWindow(hwnd);',
  '    if (dpi == 0) { return null; }',
  '    uint processId;',
  '    GetWindowThreadProcessId(hwnd, out processId);',
  '    StringBuilder title = new StringBuilder(GetWindowTextLength(hwnd) + 1);',
  '    GetWindowText(hwnd, title, title.Capacity);',
  '    WigleyWindowRow row = new WigleyWindowRow();',
  '    row.number = hwnd.ToInt64();',
  '    row.processId = processId;',
  '    row.title = title.ToString();',
  '    row.left = frame.Left;',
  '    row.top = frame.Top;',
  '    row.right = frame.Right;',
  '    row.bottom = frame.Bottom;',
  '    row.dpi = dpi;',
  '    return row;',
  '  }',
  '}',
  '"@',
  // `-InputObject` keeps a one-window array an array: a pipe would print the bare item.
  'ConvertTo-Json -InputObject @([WigleyWindowList]::List()) -Compress',
].join('\n');

const POWERSHELL_ARGS = [
  '-NoProfile',
  '-NonInteractive',
  '-EncodedCommand',
  Buffer.from(WINDOWS_WINDOW_LIST_SCRIPT, 'utf16le').toString('base64'),
];

const NUMBER_KEYS = [
  'number',
  'processId',
  'left',
  'top',
  'right',
  'bottom',
  'dpi',
] as const;

// The Windows OsWindowLister: one PowerShell run of
// `WINDOWS_WINDOW_LIST_SCRIPT` through `processes`. A run that cannot run,
// times out, exits non-zero or prints no JSON array rejects naming
// `powershell.exe`.
export function createWindowsWindowList(
  processes: ProcessRunner,
): OsWindowLister {
  return {
    async list(): Promise<readonly OsWindow[]> {
      const stdout = await requiredStdout(
        processes,
        POWERSHELL,
        POWERSHELL_ARGS,
        { timeoutMs: RUN_TIMEOUT_MS },
      );
      return parseWindowsWindowList(stdout);
    },
  };
}

// The windows of `WINDOWS_WINDOW_LIST_SCRIPT`'s stdout, in its order, each
// window's pixel bounds divided by its scale (`dpi / 96`) into points,
// unrounded; a row missing a field is dropped. Throws naming `powershell.exe`
// when the stdout is not a JSON array.
export function parseWindowsWindowList(stdout: string): OsWindow[] {
  return parseWindowRows(stdout, POWERSHELL, NUMBER_KEYS).map((row) => {
    const toPoints = (pixels: number) => (pixels * BASE_DPI) / row.dpi;
    return {
      number: row.number,
      processId: row.processId,
      title: row.title,
      bounds: {
        x: toPoints(row.left),
        y: toPoints(row.top),
        width: toPoints(row.right - row.left),
        height: toPoints(row.bottom - row.top),
      },
    };
  });
}
