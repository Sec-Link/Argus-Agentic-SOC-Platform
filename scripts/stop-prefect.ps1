[CmdletBinding()]
param(
    [switch]$WorkerOnly,
    [switch]$ConsumerOnly
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$runDir = Join-Path $repoRoot '.run'

function Stop-RecordedProcessTree {
    param([Parameter(Mandatory = $true)][string]$PidFile)

    if (-not (Test-Path $PidFile)) {
        return
    }

    $rootPid = 0
    if (-not [int]::TryParse((Get-Content $PidFile -Raw).Trim(), [ref]$rootPid)) {
        Write-Warning "Ignoring invalid PID file: $PidFile"
        return
    }

    if (Get-Process -Id $rootPid -ErrorAction SilentlyContinue) {
        Stop-Process -Id $rootPid -Force
        Wait-Process -Id $rootPid -Timeout 5 -ErrorAction SilentlyContinue
        if (Get-Process -Id $rootPid -ErrorAction SilentlyContinue) {
            throw "Failed to stop process $rootPid."
        }
    }
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

if ($WorkerOnly -and $ConsumerOnly) {
    throw 'Choose either -WorkerOnly or -ConsumerOnly.'
}
if (-not $ConsumerOnly) {
    Stop-RecordedProcessTree -PidFile (Join-Path $runDir 'prefect-worker.pid')
}
if (-not $WorkerOnly) {
    Stop-RecordedProcessTree -PidFile (Join-Path $runDir 'prefect-consumer.pid')
}
if (-not ($WorkerOnly -or $ConsumerOnly)) {
    Stop-RecordedProcessTree -PidFile (Join-Path $runDir 'prefect-server.pid')
    Write-Host 'Argus Prefect Server, Worker and Django event consumer have been stopped.'
}
else {
    Write-Host 'The selected Argus Prefect process has been stopped; Prefect Server remains running.'
}
