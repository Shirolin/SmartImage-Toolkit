param(
    [string]$Destination = ''
)

# Builds the Rust matting worker and copies it next to the workbench binary.
# Requires the Rust toolchain: https://rustup.rs
# Run with pwsh -File scripts\build-matting-worker.ps1

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$crate = Join-Path $root 'worker\matting'
if ([string]::IsNullOrWhiteSpace($Destination)) {
    $Destination = Join-Path $root 'bin'
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    $cargo = Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe'
    if (-not (Test-Path $cargo)) {
        throw 'cargo was not found. Install Rust from https://rustup.rs first.'
    }
    $env:PATH = "$(Split-Path -Parent $cargo);$env:PATH"
}

Push-Location $crate
try {
    cargo build --release
} finally {
    Pop-Location
}

New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$source = Join-Path $crate 'target\release\matting-worker.exe'
Copy-Item $source (Join-Path $Destination 'matting-worker.exe') -Force
Write-Host "Copied matting-worker.exe to $Destination"
