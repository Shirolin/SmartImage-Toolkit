param(
    [switch]$SkipWorker,
    [switch]$SkipModels,
    [switch]$SkipInstaller
)

# Builds the installable Windows app with `go tool mygo build`:
#   dist\windows-amd64\SmartImage.exe
#   dist\windows-amd64\smartimage-setup-<version>-amd64.exe
# The version comes from mygo.json. Prerequisites are built or fetched first.
# Run with pwsh -File scripts\package.ps1

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    $worker = Join-Path $root 'bin\matting-worker.exe'
    if (-not $SkipWorker -and -not (Test-Path $worker)) {
        Write-Host 'Building matting worker'
        & (Join-Path $PSScriptRoot 'build-matting-worker.ps1')
    }

    if (-not $SkipModels) {
        $missing = @('u2net.onnx', 'u2netp.onnx') | Where-Object { -not (Test-Path (Join-Path $root "models\$_")) }
        if ($missing.Count -gt 0) {
            Write-Host "Fetching matting models: $($missing -join ', ')"
            & (Join-Path $PSScriptRoot 'fetch-matting-models.ps1')
        }
    }

    $redist = Join-Path $root 'resources\windows-amd64\vc_redist.x64.exe'
    if (-not (Test-Path $redist)) {
        Write-Host 'Fetching the Visual C++ runtime'
        & (Join-Path $PSScriptRoot 'fetch-vcredist.ps1')
    }

    $BuildArgs = @('build', '-platform', 'windows/amd64')
    if ($SkipInstaller) {
        $BuildArgs += '-skip-installer'
    }
    & go tool mygo @BuildArgs
    if ($LASTEXITCODE -ne 0) {
        throw "mygo build failed with exit code $LASTEXITCODE"
    }

    $out = Join-Path $root 'dist\windows-amd64'
    Write-Host "Built into $out"
    Get-ChildItem $out -File | Where-Object { $_.Extension -in '.exe', '.zip' } |
        ForEach-Object { Write-Host ("  {0}  {1:N1} MB" -f $_.Name, ($_.Length / 1MB)) }
}
finally {
    Pop-Location
}
