param(
    [Parameter(Mandatory = $true)]
    [string]$InstallerPath,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedExecutablePath
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
$expectedExecutable = (Resolve-Path -LiteralPath $ExpectedExecutablePath).Path
$profileDirectory = Join-Path $env:APPDATA 'dump.txt'
$installDirectory = Join-Path $env:LOCALAPPDATA 'dump.txt'
$legacyDirectory = Join-Path $env:LOCALAPPDATA 'Programs\dump-txt'
$legacyGuid = 'f2f2ad60-6325-5f3c-af3b-5046ca44f4c3'
$legacyKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$legacyGuid"
$legacyInstallKey = "HKCU:\Software\$legacyGuid"
$squirrelKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\dump_txt'
$tauriKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\dump.txt'
$manufacturerKey = 'HKCU:\Software\Matt Cavender\dump.txt'
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'dump.txt.lnk'
$startMenuShortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'dump.txt.lnk'
$evidenceDirectory = Join-Path $projectDirectory ".scratch/tauri-installer/$($env:GITHUB_RUN_ID)-$($env:GITHUB_RUN_ATTEMPT)"
$observations = [Collections.Generic.List[object]]::new()
$processes = [Collections.Generic.List[object]]::new()
$installedExecutables = [Collections.Generic.List[object]]::new()
$windowDiagnostics = [Collections.Generic.List[object]]::new()

function Get-NsisPayloadHash([string]$Path) {
    $bytes = [IO.File]::ReadAllBytes($Path)
    $marker = '__TAURI_BUNDLE_TYPE_VAR_UNK'
    $binaryText = [Text.Encoding]::Latin1.GetString($bytes)
    $offset = $binaryText.IndexOf($marker, [StringComparison]::Ordinal)
    if ($offset -lt 0 -or $offset -ne $binaryText.LastIndexOf($marker, [StringComparison]::Ordinal)) {
        throw 'Expected exactly one unbundled Tauri package-type marker in the production executable.'
    }
    $replacement = [Text.Encoding]::ASCII.GetBytes('__TAURI_BUNDLE_TYPE_VAR_NSS')
    [Array]::Copy($replacement, 0, $bytes, $offset, $replacement.Length)
    return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
}

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
    installerHash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
    expectedExecutableHash = (Get-FileHash -LiteralPath $expectedExecutable -Algorithm SHA256).Hash.ToLowerInvariant()
    expectedPackagedExecutableHash = Get-NsisPayloadHash $expectedExecutable
    platform = [Environment]::OSVersion.VersionString
    method = 'Native silent installers and native window close in a disposable CI account'
    observations = $observations
    processes = $processes
    installedExecutables = $installedExecutables
    windowDiagnostics = $windowDiagnostics
    limitations = @('Wizard visuals and checkbox interaction remain unobserved.', 'Actual Squirrel uninstall remains unexecuted.')
}

function Assert-Condition([bool]$Condition, [string]$Name) {
    $observations.Add(@{ name = $Name; passed = $Condition })
    if (-not $Condition) { throw $Name }
}

function Assert-EmptyAccount {
    $paths = @(
        $profileDirectory, $installDirectory, $legacyDirectory,
        (Join-Path $env:LOCALAPPDATA 'dump_txt'),
        (Join-Path $env:APPDATA 'dump-txt'),
        (Join-Path $env:APPDATA 'com.visionsofparadise.dump-txt'),
        (Join-Path $env:LOCALAPPDATA 'com.visionsofparadise.dump-txt'),
        $desktopShortcut, $startMenuShortcut,
        $legacyKey, $legacyInstallKey, $squirrelKey, $tauriKey, $manufacturerKey,
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$legacyGuid",
        "HKCU:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\$legacyGuid"
    )
    foreach ($path in $paths) {
        if (Test-Path -LiteralPath $path) { throw "Installer tests refuse existing application data or registration: $path" }
    }
    if (Get-Process -Name 'dump-txt' -ErrorAction SilentlyContinue) {
        throw 'Installer tests refuse an existing editor process.'
    }
}

function Invoke-Installer([string]$Path, [string[]]$Arguments, [bool]$ExpectSuccess = $true) {
    $process = Start-Process -FilePath $Path -ArgumentList $Arguments -PassThru -WindowStyle Hidden
    if (-not $process.WaitForExit(180000)) {
        throw "Installer process $($process.Id) exceeded the three-minute limit."
    }
    $process.Refresh()
    $processes.Add(@{ executable = $Path; arguments = $Arguments; exitCode = $process.ExitCode })
    if ($ExpectSuccess) {
        Assert-Condition ($process.ExitCode -eq 0) "Installer succeeded: $([IO.Path]::GetFileName($Path))"
    } else {
        Assert-Condition ($process.ExitCode -ne 0) 'Installer rejects an unsafe installation attempt'
    }
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

function Record-ApplicationWindow($Process, [string]$Phase) {
    $diagnostic = [ordered]@{ phase = $Phase; processId = $Process.Id; timestamp = [DateTime]::UtcNow.ToString('o') }
    try {
        $Process.Refresh()
        $diagnostic.hasExited = $Process.HasExited
        if ($Process.HasExited) {
            $diagnostic.exitCode = $Process.ExitCode
        } else {
            $diagnostic.mainWindowHandle = $Process.MainWindowHandle.ToInt64()
            $diagnostic.mainWindowTitle = $Process.MainWindowTitle
            $diagnostic.responding = $Process.Responding
            $diagnostic.windows = @([DumpInstallerWindows]::Enumerate($Process.Id))
        }
        $diagnostic.profile = Get-ProfileSnapshot
    } catch {
        $diagnostic.error = $_.Exception.Message
    }
    $windowDiagnostics.Add($diagnostic)
}

function Test-InstalledApplication {
    $executable = Join-Path $installDirectory 'dump-txt.exe'
    Assert-Condition (Test-Path -LiteralPath $executable -PathType Leaf) 'Installed application exists'
    $installedHash = (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant()
    $installedExecutables.Add(@{ path = $executable; sha256 = $installedHash })
    Assert-Condition ($installedHash -eq $report.expectedPackagedExecutableHash) 'Installed executable matches the production build with the exact NSIS package-type marker'
    $process = Start-Process -FilePath $executable -WorkingDirectory $installDirectory -PassThru -WindowStyle Hidden
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    do {
        Start-Sleep -Milliseconds 200
        $process.Refresh()
        $editorWindows = @(Get-EditorWindows $process.Id)
    } while (-not $process.HasExited -and $editorWindows.Count -eq 0 -and [DateTime]::UtcNow -lt $deadline)
    Record-ApplicationWindow $process 'initial native window'
    Assert-Condition (-not $process.HasExited -and $editorWindows.Count -eq 1) 'Installed application reaches one visible editor window'
    $duplicate = Start-Process -FilePath $executable -WorkingDirectory $installDirectory -PassThru -WindowStyle Hidden
    Assert-Condition ($duplicate.WaitForExit(15000)) 'Second installed launch exits through the single-instance handler'
    $duplicate.Refresh()
    Assert-Condition ($duplicate.ExitCode -eq 0) 'Second installed launch exits successfully'
    Invoke-Installer $installer @('/S') $false
    $process.Refresh()
    Assert-Condition (-not $process.HasExited) 'Installer leaves the running editor alive'
    Record-ApplicationWindow $process 'before native close'
    $editorWindows = @(Get-EditorWindows $process.Id)
    Assert-Condition ($editorWindows.Count -eq 1) 'Exactly one installed editor window is selected for native close'
    $windowDiagnostics.Add(@{ phase = 'selected native close target'; window = $editorWindows[0] })
    [DumpInstallerWindows]::Close($editorWindows[0].Handle)
    Assert-Condition $true 'Native close request is posted to the installed editor window'
    $closed = $process.WaitForExit(15000)
    Record-ApplicationWindow $process 'after native close wait'
    Assert-Condition $closed 'Installed application completes guarded close'
    $process.Refresh()
    Assert-Condition ($process.ExitCode -eq 0) 'Installed application exits successfully'
    $processes.Add(@{ executable = $executable; exitCode = $process.ExitCode; method = 'native window close' })
}

function Test-Shortcuts {
    $shell = New-Object -ComObject WScript.Shell
    $explorer = New-Object -ComObject Shell.Application
    foreach ($path in @($desktopShortcut, $startMenuShortcut)) {
        Assert-Condition (Test-Path -LiteralPath $path -PathType Leaf) "Shortcut exists: $([IO.Path]::GetFileName((Split-Path -Parent $path)))"
        $shortcut = $shell.CreateShortcut($path)
        Assert-Condition ($shortcut.TargetPath -eq (Join-Path $installDirectory 'dump-txt.exe')) 'Shortcut targets the Tauri executable'
        $folder = $explorer.NameSpace((Split-Path -Parent $path))
        $item = $folder.ParseName([IO.Path]::GetFileName($path))
        Assert-Condition ($item.ExtendedProperty('System.AppUserModel.ID') -eq 'com.visionsofparadise.dump-txt') 'Shortcut retains the application identity'
    }
}

function Uninstall-Tauri {
    $uninstallerCopy = Join-Path $evidenceDirectory "uninstall-$($processes.Count).exe"
    Copy-Item -LiteralPath (Join-Path $installDirectory 'uninstall.exe') -Destination $uninstallerCopy
    Invoke-Installer $uninstallerCopy @('/S', "_?=$installDirectory")
    Assert-Condition (-not (Test-Path -LiteralPath $tauriKey)) 'Tauri uninstall removes its registration'
    Assert-Condition (-not (Test-Path -LiteralPath (Join-Path $installDirectory 'dump-txt.exe'))) 'Tauri uninstall removes its executable'
}

Assert-EmptyAccount
[void](New-Item -ItemType Directory -Path $evidenceDirectory -Force)

try {
    Invoke-Installer $installer @('/S')
    Assert-Condition (Test-Path -LiteralPath $tauriKey) 'Clean installation creates the Tauri uninstall entry'
    Test-Shortcuts
    Test-InstalledApplication
    $cleanProfile = Get-ProfileSnapshot
    Assert-Condition ($null -ne $cleanProfile['dump.txt'] -and $null -ne $cleanProfile['app-state.json']) 'Clean launch initializes the production profile'
    Uninstall-Tauri
    Assert-ProfileSnapshot $cleanProfile 'Normal uninstall preserves the document and settings'

    $unsafePath = Join-Path $evidenceDirectory 'untouched.txt'
    [IO.File]::WriteAllText($unsafePath, 'This file must remain untouched.')
    [void](New-Item -Path $legacyInstallKey -Force)
    [void](New-Item -Path $legacyKey -Force)
    Set-ItemProperty -LiteralPath $legacyInstallKey -Name InstallLocation -Value $evidenceDirectory
    Set-ItemProperty -LiteralPath $legacyKey -Name DisplayName -Value 'dump.txt'
    Set-ItemProperty -LiteralPath $legacyKey -Name Publisher -Value 'Matt Cavender'
    Set-ItemProperty -LiteralPath $legacyKey -Name UninstallString -Value 'cmd.exe /c exit 0'
    Invoke-Installer $installer @('/S') $false
    Assert-Condition ((Get-Content -LiteralPath $unsafePath -Raw) -eq 'This file must remain untouched.') 'Rejected legacy metadata leaves unrelated files intact'
    Assert-Condition (-not (Test-Path -LiteralPath $tauriKey)) 'Rejected migration does not register a successful installation'
    Remove-Item -LiteralPath $legacyKey -Recurse
    Remove-Item -LiteralPath $legacyInstallKey -Recurse

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
