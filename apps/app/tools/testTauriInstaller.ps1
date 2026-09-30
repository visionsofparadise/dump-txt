param(
    [Parameter(Mandatory = $true)]
    [string]$InstallerPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($env:CI -ne 'true' -or $env:GITHUB_ACTIONS -ne 'true' -or
    $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows' -or
    $env:GITHUB_REPOSITORY -ne 'visionsofparadise/dump-txt' -or
    $env:GITHUB_RUN_ID -notmatch '^\d+$' -or -not $env:RUNNER_TEMP) {
    throw 'Installer tests require the disposable GitHub-hosted Windows CI account.'
}

$projectDirectory = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$workspaceDirectory = [IO.Path]::GetFullPath((Join-Path $env:GITHUB_WORKSPACE 'apps/app'))
if ($projectDirectory.TrimEnd('\') -ne $workspaceDirectory.TrimEnd('\') -or
    $env:USERPROFILE -eq 'C:\Users\mttcv') {
    throw 'Installer tests refuse a local checkout or personal account.'
}

$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
$profileDirectory = Join-Path $env:APPDATA 'dump.txt'
$installDirectory = Join-Path $env:LOCALAPPDATA 'dump.txt'
$tauriKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\dump.txt'
$manufacturerKey = 'HKCU:\Software\Matt Cavender\dump.txt'
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'dump.txt.lnk'
$startMenuShortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'dump.txt.lnk'
$evidenceDirectory = Join-Path $projectDirectory ".scratch/tauri-installer/$($env:GITHUB_RUN_ID)-$($env:GITHUB_RUN_ATTEMPT)"
$observations = [Collections.Generic.List[object]]::new()

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public sealed class DumpInstallerWindowInfo {
    public long Handle { get; set; }
    public uint ProcessId { get; set; }
    public string ClassName { get; set; }
    public string Title { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public bool Visible { get; set; }
    public long Owner { get; set; }
}

public static class DumpInstallerWindows {
    private delegate bool EnumerateCallback(IntPtr handle, IntPtr parameter);
    [StructLayout(LayoutKind.Sequential)]
    private struct Rectangle { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(EnumerateCallback callback, IntPtr parameter);
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassNameW(IntPtr handle, StringBuilder value, int length);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextW(IntPtr handle, StringBuilder value, int length);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(IntPtr handle, out Rectangle rectangle);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr handle);
    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(IntPtr handle, uint command);
    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PostMessageW(IntPtr handle, uint message, IntPtr wParam, IntPtr lParam);

    public static DumpInstallerWindowInfo[] Enumerate(uint targetProcessId) {
        var result = new List<DumpInstallerWindowInfo>();
        if (!EnumWindows(delegate(IntPtr handle, IntPtr parameter) {
            uint processId;
            GetWindowThreadProcessId(handle, out processId);
            if (processId != targetProcessId) return true;
            var className = new StringBuilder(512);
            var title = new StringBuilder(4096);
            GetClassNameW(handle, className, className.Capacity);
            GetWindowTextW(handle, title, title.Capacity);
            Rectangle rectangle;
            if (!GetWindowRect(handle, out rectangle)) return true;
            result.Add(new DumpInstallerWindowInfo {
                Handle = handle.ToInt64(), ProcessId = processId,
                ClassName = className.ToString(), Title = title.ToString(),
                Width = rectangle.Right - rectangle.Left, Height = rectangle.Bottom - rectangle.Top,
                Visible = IsWindowVisible(handle), Owner = GetWindow(handle, 4).ToInt64()
            });
            return true;
        }, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
        return result.ToArray();
    }

    public static void Close(long handle) {
        if (!PostMessageW(new IntPtr(handle), 0x0010, IntPtr.Zero, IntPtr.Zero))
            throw new Win32Exception(Marshal.GetLastWin32Error());
    }
}
'@

function Get-EditorWindows([uint32]$ProcessId) {
    @([DumpInstallerWindows]::Enumerate($ProcessId) | Where-Object {
        $_.Visible -and $_.Owner -eq 0 -and $_.Width -gt 0 -and $_.Height -gt 0 -and
        $_.ClassName -ceq 'Tauri Window' -and $_.Title -ceq 'dump.txt'
    })
}

$report = [ordered]@{
    sourceCommit = $env:GITHUB_SHA
    installer = $installer
    platform = [Environment]::OSVersion.VersionString
    observations = $observations
}

function Assert-Condition([bool]$Condition, [string]$Name) {
    $observations.Add(@{ name = $Name; passed = $Condition })
    if (-not $Condition) { throw $Name }
}

function Assert-EmptyAccount {
    $paths = @(
        $profileDirectory, $installDirectory,
        (Join-Path $env:APPDATA 'com.visionsofparadise.dump-txt'),
        (Join-Path $env:LOCALAPPDATA 'com.visionsofparadise.dump-txt'),
        $desktopShortcut, $startMenuShortcut,
        $tauriKey, $manufacturerKey
    )
    foreach ($path in $paths) {
        if (Test-Path -LiteralPath $path) { throw "Installer tests refuse existing application data or registration: $path" }
    }
    if (Get-Process -Name 'dump-txt' -ErrorAction SilentlyContinue) {
        throw 'Installer tests refuse an existing editor process.'
    }
}

function Invoke-Installer([string]$Path, [string[]]$Arguments) {
    $process = Start-Process -FilePath $Path -ArgumentList $Arguments -PassThru -WindowStyle Hidden
    if (-not $process.WaitForExit(180000)) {
        throw "Installer process $($process.Id) exceeded the three-minute limit."
    }
    $process.Refresh()
    Assert-Condition ($process.ExitCode -eq 0) "Installer succeeded: $([IO.Path]::GetFileName($Path))"
}

function Get-ProfileSnapshot {
    $snapshot = [ordered]@{}
    foreach ($name in @('dump.txt', 'app-state.json', 'recovery.json')) {
        $path = Join-Path $profileDirectory $name
        $snapshot[$name] = if (Test-Path -LiteralPath $path -PathType Leaf) {
            (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
        } else { $null }
    }
    return $snapshot
}

function Assert-ProfileSnapshot($Expected, [string]$Name) {
    $actual = Get-ProfileSnapshot
    Assert-Condition (($actual | ConvertTo-Json -Compress) -eq ($Expected | ConvertTo-Json -Compress)) $Name
}

function Test-InstalledApplication {
    $executable = Join-Path $installDirectory 'dump-txt.exe'
    Assert-Condition (Test-Path -LiteralPath $executable -PathType Leaf) 'Installed application exists'
    $process = Start-Process -FilePath $executable -WorkingDirectory $installDirectory -PassThru -WindowStyle Hidden
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    do {
        Start-Sleep -Milliseconds 200
        $process.Refresh()
        $editorWindows = @(Get-EditorWindows $process.Id)
    } while (-not $process.HasExited -and $editorWindows.Count -eq 0 -and [DateTime]::UtcNow -lt $deadline)
    Assert-Condition (-not $process.HasExited -and $editorWindows.Count -eq 1) 'Installed application reaches one visible editor window'
    $duplicate = Start-Process -FilePath $executable -WorkingDirectory $installDirectory -PassThru -WindowStyle Hidden
    Assert-Condition ($duplicate.WaitForExit(15000)) 'Second installed launch exits through the single-instance handler'
    [DumpInstallerWindows]::Close($editorWindows[0].Handle)
    Assert-Condition ($process.WaitForExit(15000)) 'Installed application closes'
    $process.Refresh()
    Assert-Condition ($process.ExitCode -eq 0) 'Installed application exits successfully'
}

function Test-Shortcuts {
    $shell = New-Object -ComObject WScript.Shell
    foreach ($path in @($desktopShortcut, $startMenuShortcut)) {
        Assert-Condition (Test-Path -LiteralPath $path -PathType Leaf) "Shortcut exists: $([IO.Path]::GetFileName((Split-Path -Parent $path)))"
        Assert-Condition ($shell.CreateShortcut($path).TargetPath -eq (Join-Path $installDirectory 'dump-txt.exe')) 'Shortcut targets the installed executable'
    }
}

function Uninstall-Tauri {
    $uninstallerCopy = Join-Path $evidenceDirectory 'uninstall.exe'
    Copy-Item -LiteralPath (Join-Path $installDirectory 'uninstall.exe') -Destination $uninstallerCopy
    Invoke-Installer $uninstallerCopy @('/S', "_?=$installDirectory")
}

Assert-EmptyAccount
[void](New-Item -ItemType Directory -Path $evidenceDirectory -Force)

try {
    Invoke-Installer $installer @('/S')
    Test-Shortcuts
    Test-InstalledApplication
    $cleanProfile = Get-ProfileSnapshot
    Assert-Condition ($null -ne $cleanProfile['dump.txt'] -and $null -ne $cleanProfile['app-state.json']) 'Clean launch initializes the production profile'
    Uninstall-Tauri
    Assert-ProfileSnapshot $cleanProfile 'Normal uninstall preserves the document and settings'
    $report.passed = $true
} catch {
    $failure = $_
    $report.passed = $false
    $report.error = $_.Exception.Message
    try {
        $profileEvidence = Join-Path $evidenceDirectory 'failed-profile'
        [void](New-Item -ItemType Directory -Path $profileEvidence -Force)
        foreach ($name in @('dump.txt', 'app-state.json', 'recovery.json')) {
            $source = Join-Path $profileDirectory $name
            if (Test-Path -LiteralPath $source -PathType Leaf) {
                Copy-Item -LiteralPath $source -Destination (Join-Path $profileEvidence $name)
            }
        }
    } catch {
        $report.profileDiagnosticError = $_.Exception.Message
    }
    throw $failure
} finally {
    $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $evidenceDirectory 'report.json') -Encoding utf8
}
