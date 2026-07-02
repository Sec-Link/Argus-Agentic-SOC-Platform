param(
    [string]$ApiUrl = "http://127.0.0.1:4200/api",
    [string]$Pool = "default-process",
    [string]$VenvPath = $(Join-Path (Resolve-Path "$PSScriptRoot\..\..\..") ".venv"),
    [switch]$DryRun
)

$pythonExe = Join-Path $VenvPath "Scripts\python.exe"
if (-not (Test-Path $pythonExe)) {
    Write-Error "Python executable not found at $pythonExe. Set -VenvPath to your venv location."
    exit 1
}

$envCmd = "`$env:PREFECT_API_URL=`"$ApiUrl`""
$serverCmd = "& `"$pythonExe`" -m prefect server start"
$workerCmd = "& `"$pythonExe`" -m prefect worker start -p $Pool"

if ($DryRun) {
    Write-Host "DRY RUN: no processes started."
    Write-Host $envCmd
    Write-Host $serverCmd
    Write-Host $workerCmd
    exit 0
}

Start-Process -FilePath "powershell" -ArgumentList "-NoExit", "-Command", "$envCmd; $serverCmd"
Start-Process -FilePath "powershell" -ArgumentList "-NoExit", "-Command", "$envCmd; $workerCmd"

Write-Host "Prefect server and worker started. UI: http://127.0.0.1:4200"
