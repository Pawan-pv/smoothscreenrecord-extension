param(
  [Parameter(Mandatory = $true)][int]$X1,
  [Parameter(Mandatory = $true)][int]$Y1,
  [Parameter(Mandatory = $true)][int]$X2,
  [Parameter(Mandatory = $true)][int]$Y2,
  [int]$Steps = 30,
  [int]$DelayMs = 100
)
# QA-044: moves the REAL Windows pointer along a straight line.
#
# Playwright's page.mouse.move only moves the page's virtual pointer; the
# pointer painted into a screen capture is the OS one. J3 has to move the OS
# pointer to prove the cursor is part of the recording.
#
# System.Windows.Forms.Cursor.Position is used instead of a compiled
# SetCursorPos P/Invoke: `Add-Type` with C# source needs the compiler and took
# ~5 s on first use, which pushed the whole gesture past the first half of the
# recording. Loading the already-installed assembly takes ~0.3 s.
#
# Coordinates are in the same space as [Screen]::PrimaryScreen.Bounds (this
# PowerShell is DPI-virtualized on a scaled desktop, so Windows maps them to
# the physical pixels the screen is captured at).
Add-Type -AssemblyName System.Windows.Forms
for ($i = 0; $i -le $Steps; $i++) {
  $t = $i / $Steps
  $x = [int][Math]::Round($X1 + ($X2 - $X1) * $t)
  $y = [int][Math]::Round($Y1 + ($Y2 - $Y1) * $t)
  [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x, $y)
  Start-Sleep -Milliseconds $DelayMs
}
