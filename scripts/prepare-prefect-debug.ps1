[CmdletBinding()]
param(
    [ValidateNotNullOrEmpty()]
    [string]$DeploymentName = 'soar-generic-deployment',
    [switch]$WithSecondDeployment
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$apiUrl = 'http://127.0.0.1:4200/api'
$debugLogDir = Join-Path $repoRoot '.run\debugpy'

New-Item -ItemType Directory -Path $debugLogDir -Force | Out-Null

& (Join-Path $repoRoot '.venv\Scripts\python.exe') (Join-Path $repoRoot 'backend\manage.py') migrate workflows --check
if ($LASTEXITCODE -ne 0) {
    throw 'Apply workflow migrations with uv run python backend/manage.py migrate workflows before debugging workflows.'
}

& (Join-Path $PSScriptRoot 'stop-prefect.ps1') -WorkerOnly
& (Join-Path $PSScriptRoot 'stop-prefect.ps1') -ConsumerOnly

try {
    $healthy = Invoke-RestMethod -Uri "$apiUrl/health" -TimeoutSec 5
}
catch {
    throw 'Prefect Server is not running. Start it with scripts/start-prefect.ps1 -SkipWorker.'
}
if (-not $healthy) {
    throw 'Prefect Server health check failed.'
}

$encodedDeploymentName = [uri]::EscapeDataString($DeploymentName)
$deployment = Invoke-RestMethod -Uri "$apiUrl/deployments/name/soar-generic/$encodedDeploymentName" -TimeoutSec 5
$deploymentId = [string]$deployment.id
$parsedId = [guid]::Empty
if (-not [guid]::TryParse($deploymentId, [ref]$parsedId)) {
    throw "Prefect deployment '$DeploymentName' returned an invalid UUID."
}

$entrypoint = ([string]$deployment.entrypoint) -replace '\\', '/'
$expected = 'backend/workflows/prefect/flow.py:run_soar_workflow'
if ($entrypoint -ne $expected) {
    throw "Prefect deployment entrypoint is '$entrypoint'; expected '$expected'. Re-run scripts/start-prefect.ps1 -SkipWorker."
}

Write-Host "Prefect debug prerequisites are ready ($deploymentId)."

if ($WithSecondDeployment) {
    $secondPoolName = 'argus-workflows-debug-2'
    $secondDeploymentName = 'soar-generic-deployment-debug-2'
    $prefectExe = Join-Path $repoRoot '.venv\Scripts\prefect.exe'
    $env:PREFECT_HOME = Join-Path $repoRoot '.run\prefect'
    $env:PREFECT_API_URL = $apiUrl
    New-Item -ItemType Directory -Path (Join-Path $debugLogDir 'worker-2') -Force | Out-Null

    try {
        $secondPool = Invoke-RestMethod -Uri "$apiUrl/work_pools/$secondPoolName" -TimeoutSec 5
    }
    catch {
        if ($_.Exception.Response.StatusCode.value__ -ne 404) { throw }
        & $prefectExe work-pool create $secondPoolName --type process --no-prompt
        if ($LASTEXITCODE -ne 0) { throw "Failed to create debug work pool '$secondPoolName'." }
        $secondPool = Invoke-RestMethod -Uri "$apiUrl/work_pools/$secondPoolName" -TimeoutSec 5
    }
    if ($secondPool.type -ne 'process') {
        throw "Debug work pool '$secondPoolName' must use the process worker type."
    }

    $secondDeploymentUrl = "$apiUrl/deployments/name/soar-generic/$secondDeploymentName"
    try {
        $secondDeployment = Invoke-RestMethod -Uri $secondDeploymentUrl -TimeoutSec 5
    }
    catch {
        if ($_.Exception.Response.StatusCode.value__ -ne 404) { throw }
        Push-Location $repoRoot
        try {
            & $prefectExe deploy $expected --name $secondDeploymentName --pool $secondPoolName --tag soar --no-prompt
            if ($LASTEXITCODE -ne 0) { throw "Failed to create debug deployment '$secondDeploymentName'." }
        }
        finally { Pop-Location }
        $secondDeployment = Invoke-RestMethod -Uri $secondDeploymentUrl -TimeoutSec 5
    }
    if ($secondDeployment.work_pool_name -ne $secondPoolName -or
        (([string]$secondDeployment.entrypoint) -replace '\\', '/') -ne $expected -or
        $secondDeployment.tags -notcontains 'soar') {
        throw "Debug deployment '$secondDeploymentName' must use '$secondPoolName', the generic entrypoint and the soar tag."
    }
    Write-Host "Second debug deployment ready: $secondDeploymentName ($($secondDeployment.id)), pool $secondPoolName."
}
