param(
  [Parameter(Mandatory = $true)][string]$ProfileDir,
  [ValidateSet('top', 'normal')][string]$Mode = 'top'
)
# Raises (or un-raises) every top-level window of the browser instance that
# uses the given profile directory. Needed because the desktop in this
# environment has an always-on-top IDE window: without this the screen capture
# records the IDE instead of the page under test.
Add-Type -Namespace SmoothQa -Name W -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool SetWindowPos(System.IntPtr hWnd, System.IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, System.IntPtr lParam);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint pid);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool IsWindowVisible(System.IntPtr hWnd);
public delegate bool EnumWindowsProc(System.IntPtr hWnd, System.IntPtr lParam);
'@ -ErrorAction SilentlyContinue

$after = if ($Mode -eq 'top') { [IntPtr](-1) } else { [IntPtr](-2) }   # HWND_TOPMOST / HWND_NOTOPMOST
$flags = 0x0003 -bor 0x0040                                          # SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW

$browserPids = @()
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object { $_.CommandLine -like "*$ProfileDir*" -and $_.CommandLine -notlike '*--type=*' } |
  ForEach-Object { $browserPids += [uint32]$_.ProcessId }

$raised = 0
$handles = New-Object System.Collections.Generic.List[System.IntPtr]
$callback = [SmoothQa.W+EnumWindowsProc] {
  param($hWnd, $lParam)
  $procId = [uint32]0
  [SmoothQa.W]::GetWindowThreadProcessId($hWnd, [ref]$procId) | Out-Null
  if ($browserPids -contains $procId -and [SmoothQa.W]::IsWindowVisible($hWnd)) {
    $handles.Add($hWnd)
  }
  return $true
}
[SmoothQa.W]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null

foreach ($h in $handles) {
  [SmoothQa.W]::ShowWindow($h, 9) | Out-Null            # SWI_RESTORE
  if ([SmoothQa.W]::SetWindowPos($h, $after, 0, 0, 0, 0, $flags)) { $raised++ }
}
Write-Output "windows=$($handles.Count) raised=$raised mode=$Mode"
