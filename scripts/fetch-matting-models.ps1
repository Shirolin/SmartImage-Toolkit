param(
    [string]$Dir = ''
)

# Downloads the U2-Net matting models into models\ (or -Dir) and verifies
# their SHA-256. Models are not committed because they are ~172 MB.
# Run with pwsh -File scripts\fetch-matting-models.ps1

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($Dir)) {
    $Dir = Join-Path $root 'models'
}
New-Item -ItemType Directory -Force -Path $Dir | Out-Null

$models = @(
    @{
        Name   = 'u2netp.onnx'
        Url    = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx'
        Sha256 = '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8'
    },
    @{
        Name   = 'u2net.onnx'
        Url    = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx'
        Sha256 = '8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491'
    }
)

foreach ($model in $models) {
    $target = Join-Path $Dir $model.Name
    if (Test-Path $target) {
        $actual = (Get-FileHash -Algorithm SHA256 -Path $target).Hash.ToLowerInvariant()
        if ($actual -eq $model.Sha256) {
            Write-Host "$($model.Name) is up to date"
            continue
        }
        Remove-Item $target -Force
    }
    $temp = "$target.download"
    Write-Host "Downloading $($model.Name)..."
    Invoke-WebRequest -Uri $model.Url -OutFile $temp
    $actual = (Get-FileHash -Algorithm SHA256 -Path $temp).Hash.ToLowerInvariant()
    if ($actual -ne $model.Sha256) {
        Remove-Item $temp -Force
        throw "$($model.Name) checksum mismatch: $actual"
    }
    Move-Item $temp $target
    Write-Host "Saved $target"
}
