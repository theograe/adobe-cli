# Dialogs an Adobe app is showing on Windows: its visible top-level windows that have an owner window (a modal dialog
# is owned by the main window). Needs no permission.
#   powershell -NoProfile -File win.ps1 <pid | pr | ae | au>   ->  [{"name":…, "width":…, "height":…}]
param([string]$Want, [string]$Mode = '', [string]$Baseline = '')  # owned windows need no baseline
$names = @{ pr = 'Adobe Premiere Pro'; ae = 'AfterFX'; au = 'Adobe Audition' }
$procId = 0
if ($Want -match '^\d+$') { $procId = [int]$Want }
elseif ($names.ContainsKey($Want)) {
  $p = Get-Process -Name $names[$Want] -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($p) { $procId = $p.Id }
}
if (-not $procId) { if ($Mode -eq 'ids') { '' } else { '[]' }; exit 0 }
if ($Mode -eq 'ids') { ''; exit 0 }
Add-Type -TypeDefinition @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class AdobeCliDialogs {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [StructLayout(LayoutKind.Sequential)] struct R { public int L, T, Ri, B; }
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out R r);
  public static string List(uint want) {
    var o = new List<string>();
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p == want && IsWindowVisible(h) && GetWindow(h, 4) != IntPtr.Zero) {
        var s = new StringBuilder(256); GetWindowText(h, s, 256); R r; GetWindowRect(h, out r);
        o.Add("{\"id\":" + h.ToInt64() + ",\"on\":true,\"name\":\"" + s.ToString().Replace("\\", "\\\\").Replace("\"", "'") + "\",\"width\":" + (r.Ri - r.L) + ",\"height\":" + (r.B - r.T) + "}");
      }
      return true;
    }, IntPtr.Zero);
    return "[" + string.Join(",", o) + "]";
  }
}
'@
[AdobeCliDialogs]::List([uint32]$procId)
