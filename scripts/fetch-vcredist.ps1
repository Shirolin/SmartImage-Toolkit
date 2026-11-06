param(
    [string]$Destination = ""
)

# Downloads Microsoft's Visual C++ 2015-2022 x64 redistributable into the
# Windows resources so `go tool mygo build` ships it and the installer can
# install it. The matting worker needs it.
# The download is checked for a valid Microsoft signature, not a fixed hash,
# because aka.ms serves the current servicing release.
# Run with pwsh -File scripts\fetch-vcredist.ps1

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
if (-not $Destination) {
    $Destination = Join-Path $root 'resources\windows-amd64\vc_redist.x64.exe'
}
$url = 'https://aka.ms/vs/17/release/vc_redist.x64.exe'

$dir = Split-Path -Parent $Destination
New-Item -ItemType Directory -Force -Path $dir | Out-Null

Write-Host "Downloading $url"
Invoke-WebRequest -Uri $url -OutFile $Destination -UseBasicParsing

$sig = Get-AuthenticodeSignature -FilePath $Destination
if ($sig.Status -ne 'Valid') {
    Remove-Item $Destination -Force
    throw "Signature is $($sig.Status): $($sig.StatusMessage)"
}
if ($sig.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
    Remove-Item $Destination -Force
    throw "Unexpected signer: $($sig.SignerCertificate.Subject)"
}

$size = [math]::Round((Get-Item $Destination).Length / 1MB, 1)
Write-Host "Saved $Destination ($size MB, signed by Microsoft)"
