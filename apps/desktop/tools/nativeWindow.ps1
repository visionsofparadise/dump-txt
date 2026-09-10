param([string]$Request)
$ErrorActionPreference = 'Stop'
$requestData = $Request | ConvertFrom-Json
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NativeWindow {
  public struct Rect { public int Left, Top, Right, Bottom; }
  public struct Point { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr window, ref Point point);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr window);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
}
'@
[void][NativeWindow]::SetProcessDpiAwarenessContext([IntPtr](-4))
$matches = @(Get-Process | Where-Object { $_.Path -eq $requestData.executable })
if ($matches.Count -ne 1) { throw "Expected one isolated app window for $($requestData.executable); found $($matches.Count)" }
$window = if ($requestData.windowHandle) { [IntPtr]([long]$requestData.windowHandle) } else { $matches[0].MainWindowHandle }
$ownerProcessId = [uint32]0
[void][NativeWindow]::GetWindowThreadProcessId($window, [ref]$ownerProcessId)
if ($window -eq [IntPtr]::Zero -or $ownerProcessId -ne $matches[0].Id) { throw 'Native window handle does not belong to the isolated app process' }
$rectangle = New-Object NativeWindow+Rect
$origin = New-Object NativeWindow+Point
[void][NativeWindow]::GetWindowRect($window, [ref]$rectangle)
[void][NativeWindow]::ClientToScreen($window, [ref]$origin)
switch ($requestData.action) {
  'state' {
    @{ x=$rectangle.Left; y=$rectangle.Top; width=$rectangle.Right-$rectangle.Left; height=$rectangle.Bottom-$rectangle.Top; clientX=$origin.X; clientY=$origin.Y; minimized=[NativeWindow]::IsIconic($window); maximized=[NativeWindow]::IsZoomed($window); processId=$matches[0].Id; windowHandle=$window.ToInt64().ToString(); controls=@() } | ConvertTo-Json -Compress
  }
  'restore' { [void][NativeWindow]::ShowWindow($window, 9); [void][NativeWindow]::SetForegroundWindow($window) }
  'focus' { [void][NativeWindow]::SetForegroundWindow($window) }
  'pointer' {
    [void][NativeWindow]::SetForegroundWindow($window)
    [void][NativeWindow]::SetCursorPos($requestData.x, $requestData.y)
    [NativeWindow]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
    try {
      if ($null -ne $requestData.endX) {
        for ($step=1; $step -le 20; $step++) {
          [void][NativeWindow]::SetCursorPos(($requestData.x+($requestData.endX-$requestData.x)*$step/20), ($requestData.y+($requestData.endY-$requestData.y)*$step/20))
          Start-Sleep -Milliseconds 15
        }
      } else { Start-Sleep -Milliseconds 60 }
    } finally { [NativeWindow]::mouse_event(4,0,0,0,[UIntPtr]::Zero) }
  }
  'screenshot' {
    $bitmap = New-Object System.Drawing.Bitmap(($rectangle.Right-$rectangle.Left), ($rectangle.Bottom-$rectangle.Top))
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CopyFromScreen($rectangle.Left,$rectangle.Top,0,0,$bitmap.Size)
      $bitmap.Save($requestData.path,[System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
  }
  default { throw "Unknown native action: $($requestData.action)" }
}
