[CmdletBinding()]
param(
    [int]$TimeoutSeconds = 90,
    [switch]$SkipWorker,
    [switch]$SkipConsumer
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$runDir = Join-Path $repoRoot '.run'
$prefectHome = Join-Path $runDir 'prefect'
$prefectExe = Join-Path $repoRoot '.venv\Scripts\prefect.exe'
$pythonExe = Join-Path $repoRoot '.venv\Scripts\python.exe'
$envFile = Join-Path $repoRoot '.env'
$apiUrl = 'http://127.0.0.1:4200/api'
$workPoolName = 'argus-workflows'
$deploymentName = 'soar-generic-deployment'

function Test-TcpPort {
    param([Parameter(Mandatory = $true)][int]$Port)

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $client.Connect('127.0.0.1', $Port)
        return $true
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Wait-PrefectApi {
    param([int]$Timeout = 90)

    $deadline = (Get-Date).AddSeconds($Timeout)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri "$apiUrl/health" -TimeoutSec 3
            if ($response.StatusCode -eq 200) {
                return
            }
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }
    throw "Timed out waiting for the Prefect API. Check $runDir\prefect-server.err.log."
}

function Test-RecordedProcess {
    param([Parameter(Mandatory = $true)][string]$PidFile)

    if (-not (Test-Path $PidFile)) {
        return $false
    }
    $processId = 0
    if (-not [int]::TryParse((Get-Content $PidFile -Raw).Trim(), [ref]$processId)) {
        return $false
    }
    return $null -ne (Get-Process -Id $processId -ErrorAction SilentlyContinue)
}

function Set-DotEnvValue {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Value
    )

    $content = if (Test-Path $Path) { [IO.File]::ReadAllText($Path) } else { '' }
    $line = "$Name=$Value"
    $pattern = "(?m)^$([regex]::Escape($Name))=.*(?:\r?\n|$)"
    $content = [regex]::Replace($content, $pattern, '')
    if ($content.Length -gt 0 -and -not $content.EndsWith("`n")) {
        $content += [Environment]::NewLine
    }
    $content += $line + [Environment]::NewLine
    [IO.File]::WriteAllText($Path, $content, (New-Object Text.UTF8Encoding($false)))
}

if (-not (Test-Path $prefectExe)) {
    throw "Prefect is not installed in $prefectExe. Run the project setup first."
}

New-Item -ItemType Directory -Path $runDir -Force | Out-Null
New-Item -ItemType Directory -Path $prefectHome -Force | Out-Null

$env:PREFECT_HOME = $prefectHome
$env:PREFECT_API_URL = $apiUrl
$env:PREFECT_SERVER_ANALYTICS_ENABLED = 'false'

$serverPidFile = Join-Path $runDir 'prefect-server.pid'
if (Test-TcpPort -Port 4200) {
    Write-Host 'Port 4200 is already listening; using the existing Prefect Server.'
}
elseif (Test-RecordedProcess -PidFile $serverPidFile) {
    Write-Host 'The recorded Prefect Server is still starting; waiting for its API ...'
}
else {
    Write-Host 'Starting Prefect Server on http://127.0.0.1:4200 ...'
    $server = Start-Process -FilePath $prefectExe `
        -ArgumentList @('server', 'start', '--host', '127.0.0.1', '--port', '4200', '--analytics-off') `
        -WorkingDirectory $repoRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $runDir 'prefect-server.out.log') `
        -RedirectStandardError (Join-Path $runDir 'prefect-server.err.log') `
        -PassThru
    [IO.File]::WriteAllText($serverPidFile, [string]$server.Id)
}

Wait-PrefectApi -Timeout $TimeoutSeconds

& $prefectExe work-pool inspect $workPoolName *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Creating Prefect process work pool '$workPoolName' ..."
    & $prefectExe work-pool create $workPoolName --type process --no-prompt
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create Prefect work pool '$workPoolName'."
    }
}

Write-Host "Creating or updating Prefect deployment '$deploymentName' ..."
& $prefectExe deploy 'backend/workflows/prefect/flow.py:run_soar_workflow' `
    --name $deploymentName `
    --pool $workPoolName `
    --tag soar `
    --no-prompt
if ($LASTEXITCODE -ne 0) {
    throw "Failed to create Prefect deployment '$deploymentName'."
}

$encodedDeploymentName = [uri]::EscapeDataString($deploymentName)
$deployment = Invoke-RestMethod `
    -Uri "$apiUrl/deployments/name/soar-generic/$encodedDeploymentName" `
    -TimeoutSec 10
if (-not $deployment -or -not $deployment.id) {
    throw "Deployment '$deploymentName' was created but could not be resolved from Prefect."
}
$deploymentId = [string]$deployment.id
$parsedDeploymentId = [guid]::Empty
if (-not [guid]::TryParse($deploymentId, [ref]$parsedDeploymentId)) {
    throw "Deployment '$deploymentName' returned an invalid id: $deploymentId"
}

Set-DotEnvValue -Path $envFile -Name 'PREFECT_API_URL' -Value $apiUrl

if (Test-Path $envFile) {
    foreach ($name in @('BACKEND_ORIGIN', 'WORKFLOW_ENCRYPTION_KEYS')) {
        $line = Get-Content $envFile | Where-Object { $_ -match "^$([regex]::Escape($name))=" } | Select-Object -Last 1
        if ($line) {
            [Environment]::SetEnvironmentVariable($name, $line.Substring($line.IndexOf('=') + 1), 'Process')
        }
    }
}

$consumerPidFile = Join-Path $runDir 'prefect-consumer.pid'
if ($SkipConsumer) {
    Write-Host 'Skipping Django Prefect event consumer startup.'
}
elseif (-not (Test-RecordedProcess -PidFile $consumerPidFile)) {
    & $pythonExe (Join-Path $repoRoot 'backend\manage.py') migrate workflows --check
    if ($LASTEXITCODE -ne 0) {
        throw 'Apply workflow migrations with uv run python backend/manage.py migrate workflows before starting Prefect workers.'
    }
    Write-Host 'Starting Django Prefect event consumer ...'
    $consumer = Start-Process -FilePath $pythonExe `
        -ArgumentList @('backend/manage.py', 'consume_prefect_events') `
        -WorkingDirectory $repoRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $runDir 'prefect-consumer.out.log') `
        -RedirectStandardError (Join-Path $runDir 'prefect-consumer.err.log') `
        -PassThru
    [IO.File]::WriteAllText($consumerPidFile, [string]$consumer.Id)
    Start-Sleep -Seconds 2
    if ($consumer.HasExited) {
        throw "Prefect event consumer exited during startup. Check $runDir\prefect-consumer.err.log."
    }
}
else {
    Write-Host 'The recorded Django Prefect event consumer is already running.'
}

$workerPidFile = Join-Path $runDir 'prefect-worker.pid'
if ($SkipWorker) {
    Write-Host 'Skipping Prefect Worker startup.'
}
elseif (-not (Test-RecordedProcess -PidFile $workerPidFile)) {
    Write-Host "Starting Prefect Worker for '$workPoolName' ..."
    $worker = Start-Process -FilePath $prefectExe `
        -ArgumentList @('worker', 'start', '--pool', $workPoolName, '--name', 'argus-local-worker', '--install-policy', 'never') `
        -WorkingDirectory $repoRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $runDir 'prefect-worker.out.log') `
        -RedirectStandardError (Join-Path $runDir 'prefect-worker.err.log') `
        -PassThru
    [IO.File]::WriteAllText($workerPidFile, [string]$worker.Id)
    Start-Sleep -Seconds 2
    if ($worker.HasExited) {
        throw "Prefect Worker exited during startup. Check $runDir\prefect-worker.err.log."
    }
}
else {
    Write-Host 'The recorded Prefect Worker is already running.'
}

Write-Host ''
Write-Host 'Prefect is ready:'
Write-Host '  UI:         http://127.0.0.1:4200'
Write-Host "  API:        $apiUrl"
Write-Host "  Work pool:  $workPoolName"
Write-Host "  Deployment: $deploymentName ($deploymentId)"
Write-Host "  Logs:       $runDir"
