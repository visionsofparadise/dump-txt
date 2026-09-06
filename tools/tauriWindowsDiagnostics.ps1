param(
    [ValidateSet('Test', 'Monitor', 'Collect')]
    [string]$Mode = 'Collect'
)

$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$runIdentifier = if ($env:GITHUB_RUN_ID) { "$($env:GITHUB_RUN_ID)-$($env:GITHUB_RUN_ATTEMPT)" } else { 'local' }
$evidenceDirectory = Join-Path $projectDirectory ".scratch/tauri-test/windows-$runIdentifier"
$profileDirectory = Join-Path $evidenceDirectory 'webview-profile'
[void](New-Item -ItemType Directory -Force -Path $evidenceDirectory)

function Write-StartupSnapshot {
    $allProcesses = @(Get-CimInstance Win32_Process)
    $ownedIdentifiers = [System.Collections.Generic.HashSet[uint32]]::new()
    if ($env:TAURI_TEST_OWNER_PID) { [void]$ownedIdentifiers.Add([uint32]$env:TAURI_TEST_OWNER_PID) }
    do {
        $previousCount = $ownedIdentifiers.Count
        foreach ($process in $allProcesses) {
            if ($ownedIdentifiers.Contains($process.ParentProcessId)) { [void]$ownedIdentifiers.Add($process.ProcessId) }
        }
    } while ($ownedIdentifiers.Count -gt $previousCount)
    $nativeProcessNames = @('dump-txt.exe', 'msedgewebview2.exe', 'msedgedriver.exe', 'tauri-driver.exe')
    $processes = @($allProcesses | Where-Object { $ownedIdentifiers.Contains($_.ProcessId) -and $_.Name -in $nativeProcessNames } |
        Select-Object ProcessId, ParentProcessId, CreationDate, Name, ExecutablePath, CommandLine)
    $ports = @(Get-ChildItem -LiteralPath $profileDirectory -Filter DevToolsActivePort -File -Recurse -ErrorAction SilentlyContinue |
        ForEach-Object { @{ path = $_.FullName; content = Get-Content -LiteralPath $_.FullName -Raw; modified = $_.LastWriteTimeUtc } })
    @{ timestamp = [DateTime]::UtcNow.ToString('o'); processes = $processes; debuggingPorts = $ports } |
        ConvertTo-Json -Depth 5 -Compress | Add-Content -LiteralPath (Join-Path $evidenceDirectory 'startup.ndjson') -Encoding utf8
}

if ($Mode -eq 'Monitor') {
    $deadline = [DateTime]::UtcNow.AddMinutes(5)
    while ([DateTime]::UtcNow -lt $deadline) {
        Write-StartupSnapshot
        Start-Sleep -Seconds 3
    }
    exit 0
}

if ($Mode -eq 'Collect') {
    Write-StartupSnapshot
    Get-ChildItem -LiteralPath $evidenceDirectory -File -Recurse |
        Select-Object FullName, Length, LastWriteTimeUtc |
        ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $evidenceDirectory 'files.json') -Encoding utf8
    exit 0
}

$env:TAURI_TEST_OWNER_PID = "$PID"
$env:TAURI_TEST_WEBVIEW_DATA_FOLDER = $profileDirectory
$env:RUST_BACKTRACE = '1'
$monitorProcess = Start-Process -FilePath (Get-Process -Id $PID).Path -WindowStyle Hidden -PassThru -ArgumentList @(
    '-NoProfile', '-File', "`"$PSCommandPath`"", '-Mode', 'Monitor'
)
$testExitCode = 1
try {
    Push-Location -LiteralPath $projectDirectory
    try {
        & npm.cmd run tauri-test -- --probe
        $testExitCode = $LASTEXITCODE
    } finally { Pop-Location }
} finally {
    if (-not $monitorProcess.HasExited) { $monitorProcess.Kill(); $monitorProcess.WaitForExit() }
    Write-StartupSnapshot
}
exit $testExitCode
